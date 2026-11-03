import { useEffect } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { useAuthStore } from "./store/auth";
import { useUiStore } from "./store/ui";
import { useDocumentTheme } from "./theme";
import { DirectionApp } from "./design-directions/DirectionApp";
import { DirectionSwitcher } from "./design-directions/DirectionSwitcher";
import WorkspaceApp, { AuthGate } from "./WorkspaceApp";
import Record from "./pages/Record";
import SharedNote from "./pages/SharedNote";

function RecordRoute() {
  const { noteId } = useParams();
  const { status, user } = useAuthStore();
  if (status === "loading") return <main className="workspace-loading" role="status">Opening your workspace…</main>;
  if (!user) return <AuthGate />;
  return noteId ? <Record noteId={noteId} /> : <WorkspaceApp />;
}

function AuthenticatedDirectionRoute({ children }: { children: ReactNode }) {
  const { status, user, guestPreview } = useAuthStore();
  if (status === "loading") return <main className="workspace-loading" role="status">Opening your workspace…</main>;
  if (!user && !guestPreview) return <AuthGate />;
  return children;
}

function AuthInitializer() {
  const initialize = useAuthStore((state) => state.initialize);
  useEffect(() => initialize(), [initialize]);
  return (
    <Routes>
      <Route path="/" element={<WorkspaceApp />} />
      <Route path="/notes/:noteId" element={<WorkspaceApp />} />
      <Route path="/record/:noteId" element={<RecordRoute />} />
      <Route path="/share/:token" element={<SharedNote />} />
      <Route path="/shared/:token" element={<SharedNote />} />
      <Route path="/demo" element={<Navigate to="/" replace />} />
      <Route path="/chat-preview.html" element={<Navigate to="/" replace />} />
      <Route path="/design" element={<AuthenticatedDirectionRoute><DirectionSwitcher /></AuthenticatedDirectionRoute>} />
      <Route path="/design/:direction/*" element={<AuthenticatedDirectionRoute><DirectionApp /></AuthenticatedDirectionRoute>} />
      <Route path="*" element={<WorkspaceApp />} />
    </Routes>
  );
}

export default function App() {
  const theme = useUiStore((state) => state.theme);
  const direction = useUiStore((state) => state.direction);
  const readerSize = useUiStore((state) => state.readerTextSize);
  const readerWidth = useUiStore((state) => state.readerWidth);
  useDocumentTheme(theme, direction, readerSize, readerWidth);
  return <AuthInitializer />;
}
