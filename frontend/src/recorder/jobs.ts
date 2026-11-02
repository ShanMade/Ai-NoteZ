import { uploadPart, type AccessTokenProvider } from "./api";
import { recordingJournal, type UploadJob } from "./journal";

const RETRY_DELAYS = [30_000, 60_000, 120_000];

export class PartUploadQueue {
  private timer?: number;
  private running = false;
  private stopped = true;
  private readonly onChange: (jobs: UploadJob[]) => void;
  private readonly onPartComplete: (index: number) => void;
  private readonly tokenProvider?: AccessTokenProvider;
  private sessionId = "";

  constructor({
    tokenProvider,
    onChange,
    onPartComplete,
  }: {
    tokenProvider?: AccessTokenProvider;
    onChange: (jobs: UploadJob[]) => void;
    onPartComplete: (index: number) => void;
  }) {
    this.tokenProvider = tokenProvider;
    this.onChange = onChange;
    this.onPartComplete = onPartComplete;
  }

  async start(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    this.stopped = false;
    const jobs = await recordingJournal.getJobs(sessionId);
    for (const job of jobs) {
      if (job.status === "uploading") {
        await recordingJournal.saveJob({ ...job, status: "queued", nextAttemptAt: Date.now() });
      }
    }
    await this.refresh();
    window.addEventListener("online", this.handleOnline);
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    window.removeEventListener("online", this.handleOnline);
  }

  async enqueue(job: UploadJob): Promise<void> {
    await recordingJournal.saveJob(job);
    await this.refresh();
    this.schedule(0);
  }

  async retry(sessionId: string, index: number): Promise<void> {
    const job = await recordingJournal.getJob(sessionId, index);
    if (!job) throw new Error("The audio part is no longer available in this browser.");
    await recordingJournal.saveJob({
      ...job,
      status: "queued",
      attempts: 0,
      nextAttemptAt: Date.now(),
      error: undefined,
    });
    this.schedule(0);
  }

  private readonly handleOnline = () => this.schedule(0);

  private schedule(delay: number): void {
    if (this.stopped || this.timer !== undefined) return;
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      void this.runWithTabLock();
    }, delay);
  }

  private async runWithTabLock(): Promise<void> {
    if (this.running || this.stopped || !navigator.onLine) return;
    const run = async () => {
      if (this.running || this.stopped) return;
      this.running = true;
      try {
        await this.processQueue();
      } finally {
        this.running = false;
        if (!this.stopped) this.schedule(2000);
      }
    };

    if (navigator.locks) {
      try {
        await navigator.locks.request("notez-rec-jobs", { ifAvailable: true }, async (lock) => {
          if (lock) await run();
        });
      } catch {
        await run();
      }
      return;
    }
    await run();
  }

  private async processQueue(): Promise<void> {
    const jobs = await recordingJournal.getJobs(this.sessionId);
    for (const job of jobs) {
      if (this.stopped || !navigator.onLine) break;
      if (job.status !== "queued" || job.nextAttemptAt > Date.now()) continue;
      const uploading: UploadJob = { ...job, status: "uploading" };
      await recordingJournal.saveJob(uploading);
      await this.refresh();
      try {
        await uploadPart(job.sessionId, job.index, job.blob, job.isEmpty, this.tokenProvider);
        await recordingJournal.saveJob({ ...job, status: "done", error: undefined });
        this.onPartComplete(job.index);
      } catch (error) {
        const attempts = job.attempts + 1;
        const failed = attempts > RETRY_DELAYS.length;
        await recordingJournal.saveJob({
          ...job,
          attempts,
          status: failed ? "failed" : "queued",
          nextAttemptAt: failed ? 0 : Date.now() + RETRY_DELAYS[attempts - 1],
          error: error instanceof Error ? error.message : "The audio part could not be uploaded.",
        });
      }
      await this.refresh();
    }
  }

  private async refresh(): Promise<void> {
    this.onChange(await recordingJournal.getJobs(this.sessionId));
  }
}
