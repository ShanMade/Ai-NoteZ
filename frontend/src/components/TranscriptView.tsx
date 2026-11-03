import { useEffect, useRef, useState } from "react";
import { AudioLines, CircleDashed, Clock3 } from "lucide-react";
import type { RecordingSpeaker, TranscriptSegment } from "../recorder/types";
import { speakerColor } from "./SpeakerChips";

function formatPartTime(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function TranscriptView({
  segments,
  speakers,
  waiting,
  sessionActive,
  onCopy,
}: {
  segments: TranscriptSegment[];
  speakers: RecordingSpeaker[];
  waiting: boolean;
  sessionActive: boolean;
  onCopy?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldFollow = useRef(true);
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    if (segments.length > visibleCount) {
      setVisibleCount(segments.length);
      if (shouldFollow.current) {
        requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }));
      }
    }
  }, [segments.length, visibleCount]);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    shouldFollow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 110;
  };

  return (
    <section className="record-transcript-panel" aria-label="Live transcript">
      <header className="record-section-header">
        <div>
          <p className="record-eyebrow">THE CONVERSATION</p>
          <h2>Transcript</h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {segments.length > 0 && onCopy && (
            <button
              type="button"
              className="record-transcript-copy-btn"
              onClick={onCopy}
              title="Copy transcript to clipboard"
            >
              Copy transcript
            </button>
          )}
          {sessionActive && <span className="record-live-tag"><i /> Live</span>}
        </div>
      </header>
      <div className="record-transcript-scroll" ref={scrollRef} onScroll={handleScroll} aria-live="polite">
        {waiting && segments.length === 0 ? (
          <div className="record-transcript-empty">
            <div className="record-empty-orbit"><AudioLines size={21} /></div>
            <p className="record-empty-kicker">LISTENING IN THE BACKGROUND</p>
            <h3>Your words will find their way here.</h3>
            <p>Keep talking. Each part is saved on this device before it is sent for transcription.</p>
            <div className="record-empty-progress"><span /><span /><span /><span /><span /></div>
          </div>
        ) : segments.length === 0 ? (
          <div className="record-transcript-empty record-transcript-idle">
            <div className="record-empty-orbit"><Clock3 size={19} /></div>
            <h3>A little room for the first thought.</h3>
            <p>Your transcript will appear here once a recording part is complete.</p>
          </div>
        ) : (
          <div className="record-transcript-lines">
            {segments.map((segment) => {
              const speaker = speakers.find((item) => item.id === segment.speaker_id);
              const color = speaker ? speakerColor(speaker, speakers) : "#8b7ed6";
              return (
                <article className="record-transcript-line" key={segment.id} style={{ "--speaker-color": color } as React.CSSProperties}>
                  <span className="record-line-time">{formatPartTime(segment.start_ms)}</span>
                  <div className="record-line-copy">
                    <span className="record-line-speaker">{speaker?.display_name ?? segment.display_name ?? "Speaker"}</span>
                    {speaker?.role && <span className="record-line-role">{speaker.role}</span>}
                    <p>{segment.text}</p>
                  </div>
                </article>
              );
            })}
            {waiting && <div className="record-transcript-working"><CircleDashed size={14} /> Putting the next part into words…</div>}
          </div>
        )}
      </div>
      <footer className="record-transcript-footer">
        <span><span className="record-footer-dot" /> Speaker names can be changed anytime</span>
        <span>{segments.length} {segments.length === 1 ? "line" : "lines"}</span>
      </footer>
    </section>
  );
}
