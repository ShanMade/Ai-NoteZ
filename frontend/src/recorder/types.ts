export interface RecordingSpeaker {
  id: string;
  gemini_label: string;
  display_name: string;
  role: string | null;
  sample_text: string;
  first_seen_part: number;
  user_confirmed: boolean;
}

export interface TranscriptSegment {
  id: string;
  part_index: number;
  speaker_id: string | null;
  raw_gemini_label: string | null;
  display_name: string | null;
  role: string | null;
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface RecordingPartRead {
  part_index: number;
  status: "queued" | "processing" | "done" | "failed";
  is_empty: boolean;
  attempts: number;
  segments: TranscriptSegment[];
}

export interface RecordingSessionRead {
  session_id: string;
  note_id: string;
  status: "recording" | "processing" | "done" | "has_failed_parts" | "rate_limited";
  context_prompt: string | null;
  finish_requested: boolean;
  expected_part_count: number;
  consecutive_rate_limits: number;
}
