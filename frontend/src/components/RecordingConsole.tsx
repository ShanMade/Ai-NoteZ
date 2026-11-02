import { Pause, Play, Square } from "lucide-react";
import type { RecorderSnapshot } from "../recorder/engine";

function formatElapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return hours
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

export function RecordingConsole({
  snapshot,
  interval,
  onStart,
  onPause,
  onResume,
  onFinish,
}: {
  snapshot: RecorderSnapshot;
  interval: 20 | 30 | 40;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
}) {
  const recording = snapshot.state === "recording";
  const paused = snapshot.state === "paused";
  const busy = snapshot.state === "requesting" || snapshot.state === "stopping";
  const hasSession = Boolean(snapshot.sessionId);
  const partProgress = snapshot.elapsedSeconds < 20
    ? (snapshot.elapsedSeconds % 20) / 20
    : (snapshot.elapsedSeconds % interval) / interval;
  return (
    <section className={`record-console ${recording ? "record-console-active" : ""}`}>
      <div className="record-console-topline">
        <span className="record-eyebrow">{recording ? "CAPTURING IN REAL TIME" : paused ? "RECORDING PAUSED" : "YOUR RECORDING SPACE"}</span>
        {recording && <span className="recording-status"><i /> Recording</span>}
      </div>
      <div className="record-console-center">
        <div className={`recording-orb ${recording ? "recording-orb-pulse" : ""}`} aria-hidden="true">
          <div className="recording-orb-inner"><span /></div>
        </div>
        <div className="record-clock" aria-label={`Elapsed time ${formatElapsed(snapshot.elapsedSeconds)}`}>
          {formatElapsed(snapshot.elapsedSeconds)}
        </div>
        <p className="record-console-caption">
          {recording ? "Stay with the conversation. We’re keeping up." : paused ? "Take your time. Your place is held." : "One press, then back to the moment."}
        </p>
      </div>
      <div className="record-level-meter" role="meter" aria-label="Microphone input level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(snapshot.level * 100)}>
        {Array.from({ length: 32 }, (_, index) => {
          const threshold = ((index % 8) + 2) / 40;
          const lit = recording && threshold < snapshot.level;
          return <span key={index} className={lit ? "meter-bar-lit" : ""} style={{ opacity: index < 3 || index > 28 ? 0.45 : 1 }} />;
        })}
      </div>
      <div className="record-part-progress">
        <span>PART {String(snapshot.partIndex + 1).padStart(2, "0")}</span>
        <div><i style={{ transform: `scaleX(${recording ? partProgress : 0})` }} /></div>
        <span>{recording ? "SAVED LOCALLY" : "READY WHEN YOU ARE"}</span>
      </div>
      <div className="record-console-actions">
        {!hasSession || snapshot.state === "finished" || snapshot.state === "error" ? (
          <button type="button" className="record-main-action" onClick={onStart} disabled={busy}>
            <Play size={16} fill="currentColor" /> {busy ? "Connecting…" : "Start recording"}
          </button>
        ) : (
          <>
            <button type="button" className="record-icon-action" onClick={paused ? onResume : onPause} disabled={!recording && !paused} aria-label={paused ? "Resume recording" : "Pause recording"}>
              {paused ? <Play size={17} /> : <Pause size={17} />}
            </button>
            <button type="button" className="record-main-action record-finish-action" onClick={onFinish} disabled={busy}>
              <Square size={13} fill="currentColor" /> {busy ? "Saving…" : "Finish recording"}
            </button>
          </>
        )}
      </div>
      {snapshot.warning && <p className="record-console-warning" role="status">{snapshot.warning}</p>}
    </section>
  );
}
