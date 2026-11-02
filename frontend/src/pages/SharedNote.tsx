import { useQuery } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import { useParams } from "react-router-dom";
import "./shared-note.css";

interface SharedNoteData {
  title: string;
  body: string;
  kind: string;
  folder_path: string;
  created_at: string;
  updated_at: string;
}

const apiBase = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";

async function fetchSharedNote(token: string): Promise<SharedNoteData> {
  const response = await fetch(`${apiBase}/v1/notes/shared/${encodeURIComponent(token)}`);
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(failure?.detail ?? "This shared note is unavailable.");
  }
  return response.json() as Promise<SharedNoteData>;
}

export default function SharedNote() {
  const { token = "" } = useParams();
  const query = useQuery({ queryKey: ["shared-note", token], queryFn: () => fetchSharedNote(token), enabled: Boolean(token) });
  if (query.isPending) return <main className="shared-note-state">Opening shared note…</main>;
  if (query.error || !query.data) return <main className="shared-note-state" role="alert">{query.error instanceof Error ? query.error.message : "This shared note is unavailable."}</main>;

  return (
    <main className="shared-note-page">
      <header className="shared-note-header"><span><BookOpen size={16} /></span> Notez<span className="shared-note-period">.</span><small>Shared note · Read only</small></header>
      <article className="shared-note-content">
        <p className="shared-note-eyebrow">{query.data.folder_path || "A note"} · {query.data.kind}</p>
        <h1>{query.data.title || "Untitled note"}</h1>
        <div className="shared-note-body" dir="auto">{query.data.body}</div>
      </article>
    </main>
  );
}
