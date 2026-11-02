import { createSession, fetchSession, finishSession, type AccessTokenProvider } from "./api";
import { PartUploadQueue } from "./jobs";
import { recordingJournal, type JournalSession, type UploadJob } from "./journal";
import { closeAndQueuePart } from "./parts";

export type RecorderState = "idle" | "requesting" | "recording" | "paused" | "stopping" | "finished" | "error";

export interface RecorderSnapshot {
  state: RecorderState;
  elapsedSeconds: number;
  partIndex: number;
  level: number;
  warning: string | null;
  jobs: UploadJob[];
  sessionId: string | null;
}

export class BrowserRecorder {
  private readonly noteId: string;
  private contextPrompt: string;
  private interval: 20 | 30 | 40;
  private readonly tokenProvider?: AccessTokenProvider;
  private readonly onChange: (snapshot: RecorderSnapshot) => void;
  private snapshot: RecorderSnapshot = {
    state: "idle",
    elapsedSeconds: 0,
    partIndex: 0,
    level: 0,
    warning: null,
    jobs: [],
    sessionId: null,
  };
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private audioContext?: AudioContext;
  private analyser?: AnalyserNode;
  private animationFrame?: number;
  private elapsedTimer?: number;
  private partTimer?: number;
  private session?: JournalSession;
  private partFromSeq = 0;
  private nextSeq = 0;
  private startedAt = 0;
  private pausedAt = 0;
  private totalPausedMs = 0;
  private elapsedBeforeCaptureMs = 0;
  private readonly pendingWrites = new Map<number, Promise<void>>();
  private queue?: PartUploadQueue;

  constructor({
    noteId,
    contextPrompt = "",
    interval = 40,
    tokenProvider,
    onChange,
  }: {
    noteId: string;
    contextPrompt?: string;
    interval?: 20 | 30 | 40;
    tokenProvider?: AccessTokenProvider;
    onChange: (snapshot: RecorderSnapshot) => void;
  }) {
    this.noteId = noteId;
    this.contextPrompt = contextPrompt;
    this.interval = interval;
    this.tokenProvider = tokenProvider;
    this.onChange = onChange;
  }

  get current(): RecorderSnapshot {
    return this.snapshot;
  }

  updateSettings(contextPrompt: string, interval: 20 | 30 | 40): void {
    if (this.snapshot.sessionId) return;
    this.contextPrompt = contextPrompt;
    this.interval = interval;
  }

  async start(): Promise<void> {
    if (this.snapshot.state === "recording" || this.snapshot.state === "requesting") return;
    this.update({ state: "requesting", warning: null });
    try {
      await this.acquireMedia();
      const { session_id: sessionId } = await createSession(this.noteId, this.contextPrompt, this.tokenProvider);
      this.session = {
        sessionId,
        noteId: this.noteId,
        nextSequence: 0,
        nextPartIndex: 0,
        configuredInterval: this.interval,
        elapsedMs: 0,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        status: "recording",
      };
      await recordingJournal.saveSession(this.session);
      this.nextSeq = this.session.nextSequence;
      this.partFromSeq = this.nextSeq;
      this.startedAt = Date.now();
      this.totalPausedMs = 0;
      this.elapsedBeforeCaptureMs = 0;
      this.update({ sessionId, partIndex: 0, elapsedSeconds: 0 });
      this.startCapture();
    } catch (error) {
      this.releaseMedia();
      this.update({
        state: "error",
        warning: error instanceof Error ? error.message : "The recording could not be started.",
      });
    }
  }

  async resume(sessionId: string): Promise<void> {
    if (this.snapshot.state === "recording" || this.snapshot.state === "requesting") return;
    this.update({ state: "requesting", warning: null });
    try {
      const [remote, local] = await Promise.all([
        fetchSession(sessionId, this.tokenProvider),
        recordingJournal.getSession(sessionId),
      ]);
      if (!local || remote.note_id !== this.noteId || remote.status === "done") {
        throw new Error("This recording cannot be resumed in the current note.");
      }
      if (remote.status === "has_failed_parts") {
        throw new Error("Retry the failed recording parts before continuing.");
      }
      await this.acquireMedia();
      this.session = { ...local, status: "recording", updatedAt: Date.now() };
      await recordingJournal.saveSession(this.session);
      this.nextSeq = local.nextSequence;
      this.partFromSeq = local.nextSequence;
      this.startedAt = Date.now();
      this.totalPausedMs = 0;
      this.elapsedBeforeCaptureMs = local.elapsedMs ?? local.nextSequence * 1000;
      this.update({
        sessionId,
        partIndex: local.nextPartIndex,
        elapsedSeconds: Math.floor(this.elapsedBeforeCaptureMs / 1000),
      });
      this.startCapture();
    } catch (error) {
      this.releaseMedia();
      this.update({
        state: "error",
        warning: error instanceof Error ? error.message : "The recording could not be resumed.",
      });
    }
  }

  pause(): void {
    if (this.snapshot.state !== "recording" || !this.recorder) return;
    this.recorder.pause();
    this.pausedAt = Date.now();
    this.clearTimers();
    if (this.session) {
      this.session.elapsedMs = this.currentElapsedMs();
      this.session.updatedAt = this.pausedAt;
      void recordingJournal.saveSession(this.session).catch((error: unknown) => {
        this.update({
          warning: error instanceof Error ? error.message : "The paused recording time could not be saved.",
        });
      });
    }
    this.update({ elapsedSeconds: Math.floor(this.currentElapsedMs() / 1000) });
    this.update({ state: "paused" });
  }

  resumeCapture(): void {
    if (this.snapshot.state !== "paused" || !this.recorder) return;
    this.totalPausedMs += Date.now() - this.pausedAt;
    this.recorder.resume();
    this.update({ state: "recording" });
    this.schedulePartClose();
    this.startElapsedTimer();
    this.updateLevel();
  }

  async stopAndFinish(): Promise<void> {
    if (!this.recorder || !this.session) return;
    if (this.snapshot.state === "paused") {
      this.totalPausedMs += Date.now() - this.pausedAt;
    }
    this.update({
      state: "stopping",
      elapsedSeconds: Math.floor(this.currentElapsedMs() / 1000),
    });
    this.clearTimers();
    await new Promise<void>((resolve) => {
      this.recorder!.addEventListener("stop", () => resolve(), { once: true });
      if (this.recorder!.state !== "inactive") this.recorder!.stop();
      else resolve();
    });
    await Promise.all(this.pendingWrites.values());
    await this.closeCurrentPart();
    this.session.status = "finished";
    this.session.updatedAt = Date.now();
    await recordingJournal.saveSession(this.session);
    try {
      await finishSession(this.session.sessionId, this.session.nextPartIndex, this.tokenProvider);
      this.update({ state: "finished", level: 0 });
    } catch (error) {
      this.update({
        state: "error",
        warning: error instanceof Error ? error.message : "The recording was saved, but could not be finalized.",
      });
    } finally {
      this.releaseMedia();
    }
  }

  dispose(): void {
    this.clearTimers();
    this.queue?.stop();
    if (this.recorder?.state === "recording" || this.recorder?.state === "paused") {
      this.recorder.stop();
    }
    this.releaseMedia();
  }

  private async acquireMedia(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("This browser does not support microphone recording.");
    }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioContext = new AudioContext();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 512;
    this.audioContext.createMediaStreamSource(this.stream).connect(this.analyser);
  }

  private startCapture(): void {
    if (!this.stream || !this.session) throw new Error("Microphone access is not available.");
    const mimeType = [
      "audio/webm;codecs=opus",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.recorder.addEventListener("dataavailable", (event) => {
      if (!event.data.size || !this.session) return;
      const seq = this.nextSeq;
      this.nextSeq += 1;
      const commit = recordingJournal.writeSlice({
        sessionId_slot_seq: `${this.session.sessionId}_0_${seq}`,
        sessionId: this.session.sessionId,
        slot: 0,
        seq,
        blob: event.data,
      }).then(async () => {
        if (!this.session) return;
        this.session.nextSequence = Math.max(this.session.nextSequence, seq + 1);
        this.session.elapsedMs = this.currentElapsedMs();
        this.session.updatedAt = Date.now();
        await recordingJournal.saveSession(this.session);
        if (recordingJournal.degraded) {
          this.update({ warning: "This browser is using temporary in-memory recording storage." });
        }
      }).catch(() => {
        this.update({ warning: "The recording journal could not commit a slice; a few seconds may be lost." });
      }).finally(() => {
        this.pendingWrites.delete(seq);
      });
      this.pendingWrites.set(seq, commit);
    });
    this.recorder.addEventListener("error", () => {
      this.update({ warning: "The browser reported a microphone recording error." });
    });
    this.recorder.start(1000);
    this.update({ state: "recording" });
    this.startElapsedTimer();
    this.schedulePartClose();
    this.updateLevel();

    this.queue = new PartUploadQueue({
      tokenProvider: this.tokenProvider,
      onChange: (jobs) => this.update({ jobs }),
      onPartComplete: () => undefined,
    });
    void this.queue.start(this.session.sessionId);
  }

  private async closeCurrentPart(): Promise<void> {
    if (!this.session) return;
    const fromSeq = this.partFromSeq;
    const toSeq = this.nextSeq - 1;
    if (toSeq < fromSeq) return;
    await Promise.all(
      [...this.pendingWrites.entries()]
        .filter(([seq]) => seq >= fromSeq && seq <= toSeq)
        .map(([, commit]) => commit),
    );
    const index = this.session.nextPartIndex;
    const result = await closeAndQueuePart({
      sessionId: this.session.sessionId,
      index,
      fromSeq,
      toSeq,
      mimeType: this.recorder?.mimeType || "audio/webm",
      queue: this.queue!,
    });
    this.session.nextPartIndex = index + 1;
    this.session.updatedAt = Date.now();
    this.partFromSeq = toSeq + 1;
    await recordingJournal.saveSession(this.session);
    this.update({ partIndex: this.session.nextPartIndex });
    if (result.isEmpty) this.update({ warning: "A silent part was saved locally and skipped for transcription." });
  }

  private schedulePartClose(): void {
    if (this.snapshot.state === "paused" || this.snapshot.state === "stopping") return;
    if (this.partTimer !== undefined) window.clearTimeout(this.partTimer);
    const isFirstPart = this.session?.nextPartIndex === 0;
    const durationSeconds = isFirstPart ? 20 : this.interval;
    this.partTimer = window.setTimeout(() => {
      this.partTimer = undefined;
      void this.closeCurrentPart().catch(() => {
        this.update({ warning: "This recording part could not be journaled. Recording will continue." });
      }).finally(() => this.schedulePartClose());
    }, durationSeconds * 1000);
  }

  private startElapsedTimer(): void {
    if (this.elapsedTimer !== undefined) window.clearInterval(this.elapsedTimer);
    this.elapsedTimer = window.setInterval(() => {
      const elapsedMs = this.currentElapsedMs();
      this.update({ elapsedSeconds: Math.max(0, Math.floor(elapsedMs / 1000)) });
    }, 250);
  }

  private currentElapsedMs(): number {
    const activeUntil = this.snapshot.state === "paused" ? this.pausedAt : Date.now();
    const activeSinceResume = Math.max(0, activeUntil - this.startedAt - this.totalPausedMs);
    return this.elapsedBeforeCaptureMs + activeSinceResume;
  }

  private updateLevel = (): void => {
    if (!this.analyser || this.snapshot.state !== "recording") return;
    const samples = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(samples);
    let squares = 0;
    for (const sample of samples) {
      const normalized = (sample - 128) / 128;
      squares += normalized * normalized;
    }
    const level = Math.min(1, Math.sqrt(squares / samples.length) * 4);
    this.update({ level });
    this.animationFrame = window.requestAnimationFrame(this.updateLevel);
  };

  private clearTimers(): void {
    if (this.elapsedTimer !== undefined) window.clearInterval(this.elapsedTimer);
    if (this.partTimer !== undefined) window.clearTimeout(this.partTimer);
    if (this.animationFrame !== undefined) window.cancelAnimationFrame(this.animationFrame);
    this.elapsedTimer = undefined;
    this.partTimer = undefined;
    this.animationFrame = undefined;
  }

  private releaseMedia(): void {
    this.clearTimers();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    void this.audioContext?.close();
    this.audioContext = undefined;
    this.analyser = undefined;
    this.queue?.stop();
  }

  private update(changes: Partial<RecorderSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...changes };
    this.onChange(this.snapshot);
  }
}
