import { useState, type FormEvent } from "react";
import { Check, ChevronDown, Mic2, UserRound } from "lucide-react";
import type { RecordingSpeaker } from "../recorder/types";

const colors = ["#8b7ed6", "#d18b66", "#4d9a83", "#5f8ec6", "#c06e8d", "#aa8f4e"];

export function speakerColor(speaker: RecordingSpeaker, speakers: RecordingSpeaker[]): string {
  const index = speakers.findIndex((item) => item.id === speaker.id);
  return colors[Math.max(0, index) % colors.length];
}

export function SpeakerChips({
  speakers,
  onSave,
}: {
  speakers: RecordingSpeaker[];
  onSave: (speaker: RecordingSpeaker, name: string, role: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<RecordingSpeaker | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const beginEdit = (speaker: RecordingSpeaker) => {
    setEditing(speaker);
    setName(speaker.display_name);
    setRole(speaker.role ?? "");
    setError("");
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || !name.trim()) return;
    setSaving(true);
    setError("");
    try {
      await onSave(editing, name.trim(), role.trim());
      setEditing(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The speaker could not be updated.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="record-speaker-list" aria-label="Speakers in this recording">
        {speakers.map((speaker) => (
          <button
            type="button"
            className="record-speaker-chip"
            key={speaker.id}
            style={{ "--speaker-color": speakerColor(speaker, speakers) } as React.CSSProperties}
            onClick={() => beginEdit(speaker)}
            title="Rename speaker or change their role"
          >
            <span className="record-speaker-dot" />
            <span>{speaker.display_name}</span>
            {speaker.role && <small>{speaker.role}</small>}
            {speaker.user_confirmed ? <Check size={12} aria-label="Confirmed" /> : <ChevronDown size={12} />}
          </button>
        ))}
        {!speakers.length && <span className="record-speaker-waiting"><Mic2 size={13} /> Speakers appear after the first part</span>}
      </div>
      {editing && (
        <div className="record-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setEditing(null);
        }}>
          <form className="record-speaker-dialog" onSubmit={(event) => void save(event)} aria-label="Edit speaker">
            <div className="record-dialog-icon"><UserRound size={17} /></div>
            <p className="record-eyebrow">SPEAKER DETAILS</p>
            <h2>Make this voice yours.</h2>
            <label>
              Display name
              <input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={160} />
            </label>
            <label>
              Role <span>optional</span>
              <input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Teacher, host, guest…" maxLength={80} />
            </label>
            {error && <p className="record-inline-error">{error}</p>}
            <div className="record-dialog-actions">
              <button type="button" className="record-button record-button-quiet" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="record-button record-button-primary" disabled={saving || !name.trim()}>
                {saving ? "Saving…" : "Save speaker"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
