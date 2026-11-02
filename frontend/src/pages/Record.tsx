import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, CloudOff, Headphones, Radio, RotateCw, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { fetchPart, fetchSession, fetchSpeakers, manualRetryPart, renameSpeaker, type AccessTokenProvider } from "../recorder/api";
import { BrowserRecorder, type RecorderSnapshot } from "../recorder/engine";
import { recordingJournal, type JournalSession } from "../recorder/journal";
import type { RecordingPartRead, RecordingSpeaker, TranscriptSegment } from "../recorder/types";
import { RecordingConsole } from "../components/RecordingConsole";
import { SpeakerChips } from "../components/SpeakerChips";
import { TranscriptView } from "../components/TranscriptView";
import "./recording.css";

const initialSnapshot: RecorderSnapshot = {
  state: "idle",
  elapsedSeconds: 0,
  partIndex: 0,
  level: 0,
  warning: null,
  jobs: [],
  sessionId: null,
};

function formatRecoveredDuration(elapsedMs = 0): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function useAccessToken(tokenProvider?: AccessTokenProvider): AccessTokenProvider {
  const providerRef = useRef(tokenProvider);
  providerRef.current = tokenProvider;
  return useMemo(() => async () => {
    const provider = providerRef.current ?? window.notezAuth?.getIdToken;
    if (!provider) throw new Error("Sign in to record. The app has not provided an authentication token.");
    return provider();
  }, []);
}

export default function Record({
  noteId,
  getAccessToken,
}: {
  noteId: string;
  getAccessToken?: AccessTokenProvider;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [contextPrompt, setContextPrompt] = useState("");
  const [interval, setIntervalValue] = useState<20 | 30 | 40>(40);
  const [recoverable, setRecoverable] = useState<JournalSession | null>(null);
  const [parts, setParts] = useState<Record<number, RecordingPartRead>>({});
  const [speakers, setSpeakers] = useState<RecordingSpeaker[]>([]);
  const [remoteStatus, setRemoteStatus] = useState("");
  const [retryingPart, setRetryingPart] = useState<number | null>(null);
  const [pageError, setPageError] = useState("");
  const engineRef = useRef<BrowserRecorder>();
  const navigate = useNavigate();
  const accessToken = useAccessToken(getAccessToken);

  useEffect(() => {
    const engine = new BrowserRecorder({
      noteId,
      contextPrompt,
      interval,
      tokenProvider: accessToken,
      onChange: setSnapshot,
    });
    engineRef.current = engine;
    void recordingJournal.listSessions().then((sessions) => {
      const active = sessions.find((session) => session.noteId === noteId && session.status === "recording");
      if (active) setRecoverable(active);
    });
    return () => {
      engine.dispose();
      engineRef.current = undefined;
    };
  }, [accessToken, noteId]);

  useEffect(() => {
    engineRef.current?.updateSettings(contextPrompt, interval);
  }, [contextPrompt, interval]);

  const sessionId = snapshot.sessionId;

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    const refresh = async () => {
      try {
        const [session, currentSpeakers] = await Promise.all([
          fetchSession(sessionId, accessToken),
          fetchSpeakers(sessionId, accessToken),
        ]);
        if (!active) return;
        setRemoteStatus(session.status);
        setSpeakers(currentSpeakers);
        const indexes = [...new Set(snapshot.jobs.map((job) => job.index))];
        const partReads = await Promise.all(indexes.map((index) => fetchPart(sessionId, index, accessToken)));
        if (active) {
          setParts(Object.fromEntries(partReads.map((part) => [part.part_index, part])));
          if (session.status === "rate_limited") {
            setPageError("Transcription is waiting for Gemini’s rate limit to clear. Your audio remains saved.");
          } else if (session.status === "has_failed_parts") {
            setPageError("One or more parts need a retry. Your transcript and original audio are still here.");
          }
        }
      } catch (error) {
        if (active) setPageError(error instanceof Error ? error.message : "The recording status could not be refreshed.");
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [accessToken, sessionId, snapshot.jobs]);

  const transcript = useMemo<TranscriptSegment[]>(
    () => Object.values(parts)
      .flatMap((part) => part.segments)
      .sort((left, right) => left.part_index - right.part_index || left.start_ms - right.start_ms),
    [parts],
  );
  const waitingForSpeech = snapshot.state === "recording" || snapshot.state === "paused" || remoteStatus === "processing";
  const sessionActive = snapshot.state === "recording" || snapshot.state === "paused";

  const start = () => {
    setPageError("");
    setRecoverable(null);
    void engineRef.current?.start();
  };
  const resume = () => {
    if (!recoverable) return;
    setPageError("");
    void engineRef.current?.resume(recoverable.sessionId);
    setRecoverable(null);
  };
  const saveSpeaker = async (speaker: RecordingSpeaker, name: string, role: string) => {
    if (!sessionId) return;
    const previous = speakers;
    setSpeakers((items) => items.map((item) => item.id === speaker.id ? { ...item, display_name: name, role: role || null, user_confirmed: true } : item));
    try {
      const saved = await renameSpeaker(sessionId, speaker.id, name, role, accessToken);
      setSpeakers((items) => items.map((item) => item.id === saved.id ? saved : item));
    } catch (error) {
      setSpeakers(previous);
      throw error;
    }
  };
  const retryPart = async (index: number) => {
    if (!sessionId) return;
    setRetryingPart(index);
    setPageError("");
    try {
      const job = await recordingJournal.getJob(sessionId, index);
      if (!job) throw new Error("The audio part is not available in this browser for manual retry.");
      await manualRetryPart(sessionId, index, job.blob, accessToken);
      setParts((current) => ({
        ...current,
        [index]: { ...current[index], status: "queued" },
      }));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "The recording part could not be retried.");
    } finally {
      setRetryingPart(null);
    }
  };

  return (
    <div className="record-page">
      <header className="record-page-header">
        <button className="record-back-button" type="button" aria-label="Back to note" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} /><span>Back to note</span>
        </button>
        <div className="record-brand"><span className="record-brand-mark"><Radio size={15} /></span> Notez<span className="record-brand-dot">.</span><span className="record-brand-divider" /> Recording
        </div>
        <div className="record-header-status">
          {navigator.onLine ? <><ShieldCheck size={14} /> Private session</> : <><CloudOff size={14} /> Offline · saved here</>}
        </div>
      </header>

      <main className="record-layout">
        <section className="record-overview">
          <div className="record-breadcrumb"><span>YOUR LIBRARY</span><i>·</i><span>RECORDING NOTE</span></div>
          <div className="record-title-row">
            <div>
              <p className="record-eyebrow">A THOUGHT, HELD IN REAL TIME</p>
              <h1>Record a conversation</h1>
              <p className="record-subtitle">Stay in the room. Your words will be here when you’re ready.</p>
            </div>
            {remoteStatus === "done" && <span className="record-done-badge"><Check size={14} /> Saved to your notes</span>}
          </div>
          <div className="record-settings-row">
            <label className="record-context-setting">
              <span>Conversation context <small>helps keep speakers consistent</small></span>
              <input
                value={contextPrompt}
                onChange={(event) => setContextPrompt(event.target.value)}
                placeholder="e.g. Classroom, one teacher and a group of students"
                disabled={Boolean(sessionId)}
                maxLength={4000}
              />
            </label>
            <label className="record-interval-setting">
              <span>Part length</span>
              <select value={interval} onChange={(event) => setIntervalValue(Number(event.target.value) as 20 | 30 | 40)} disabled={Boolean(sessionId)}>
                <option value={20}>20 seconds</option>
                <option value={30}>30 seconds</option>
                <option value={40}>40 seconds</option>
              </select>
            </label>
          </div>
        </section>

        {recoverable && !sessionId && (
          <aside className="record-recovery-card" aria-labelledby="record-recovery-title">
            <div className="record-recovery-icon"><RotateCw size={17} /></div>
            <div>
              <strong id="record-recovery-title">Pick up where you left off.</strong>
              <p>{formatRecoveredDuration(recoverable.elapsedMs ?? recoverable.nextSequence * 1000)} recorded · {recoverable.nextPartIndex} saved {recoverable.nextPartIndex === 1 ? "part" : "parts"}.</p>
            </div>
            <div className="record-recovery-actions">
              <button type="button" className="record-button record-button-primary" onClick={resume}>Resume recording</button>
              <button type="button" className="record-recovery-dismiss" onClick={() => setRecoverable(null)}>Not now</button>
            </div>
          </aside>
        )}

        <div className="record-workspace">
          <div className="record-left-column">
            <RecordingConsole
              snapshot={snapshot}
              interval={interval}
              onStart={start}
              onPause={() => engineRef.current?.pause()}
              onResume={() => engineRef.current?.resumeCapture()}
              onFinish={() => void engineRef.current?.stopAndFinish()}
            />
            <section className="record-speakers-panel">
              <header className="record-section-header">
                <div><p className="record-eyebrow">A FEW VOICES, ONE STORY</p><h2>In this room</h2></div>
                {speakers.length > 0 && <span className="record-speaker-count">{speakers.length} {speakers.length === 1 ? "speaker" : "speakers"}</span>}
              </header>
              <SpeakerChips speakers={speakers} onSave={saveSpeaker} />
            </section>
            <div className="record-storage-note"><Headphones size={14} /><span>Audio is saved in this browser and uploaded in parts for transcription.</span></div>
          </div>

          <div className="record-right-column">
            <TranscriptView
              segments={transcript}
              speakers={speakers}
              waiting={waitingForSpeech}
              sessionActive={sessionActive}
            />
            {!!snapshot.jobs.length && (
              <section className="record-parts-panel">
                <div className="record-parts-title"><span>PARTS</span><span>{snapshot.jobs.filter((job) => job.status === "done").length} / {snapshot.jobs.length} uploaded</span></div>
                <div className="record-parts-list">
                  {snapshot.jobs.map((job) => {
                    const serverPart = parts[job.index];
                    const status = serverPart?.status ?? job.status;
                    return (
                      <div className="record-part-row" key={job.sessionId_index}>
                        <span className={`record-part-state record-part-${status}`} />
                        <span>Part {String(job.index + 1).padStart(2, "0")}</span>
                        <small>{status === "done" ? "Transcribed" : status === "processing" ? "Finding the words" : status === "queued" ? "Saved · waiting to send" : "Needs a retry"}</small>
                        {status === "failed" && (
                          <button type="button" onClick={() => void retryPart(job.index)} disabled={retryingPart === job.index}>
                            {retryingPart === job.index ? "Retrying…" : "Retry"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        </div>
        {(pageError || snapshot.warning) && (
          <div className="record-status-message" role="status">{pageError || snapshot.warning}</div>
        )}
      </main>
      <footer className="record-page-footer">
        <span>Notez <i>·</i> Your thoughts, in good company.</span>
        <span>{snapshot.jobs.some((job) => job.status === "queued" || job.status === "uploading") ? "Waiting for a connection to sync" : "All changes saved"}</span>
      </footer>
    </div>
  );
}
