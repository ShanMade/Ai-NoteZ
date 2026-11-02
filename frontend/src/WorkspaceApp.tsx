import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, ChevronRight, Cloud, Command, FileDown,
  FilePlus2, Folder, Layers3, Menu, Mic2, Moon, Network, Plus, Search, Settings2, Share2,
  Sparkles, Sun, Trash2, X,
} from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { LanguageChoice } from "./i18n";
import { apiRequest } from "./api/client";
import { createNote, deleteNote, getChildren, getNote, listAllNotes, shareNote, updateNote, type Note, type NoteInput } from "./api/notes";
import { getCachedNotes, getQueuedOperations, saveCachedNotes } from "./offline/queue";
import { VersionConflictError } from "./api/client";
import ChatPanel from "./components/ChatPanel";
import { useOfflineSync } from "./hooks/useOfflineSync";
import { useAuthStore } from "./store/auth";
import { useUiStore } from "./store/ui";
import "./workspace.css";

type SaveState = "saved" | "saving" | "unsaved" | "error";
const NoteBodyEditor = lazy(() => import("./editor/NoteBodyEditor").then((module) => ({ default: module.NoteBodyEditor })));
const noteListKey = (ownerId: string) => ["notes", ownerId] as const;
const noteDetailKey = (ownerId: string, noteId: string) => ["notes", ownerId, noteId] as const;

export function AuthGate() {
  const {
    setupError,
    signInWithGoogle,
    signInWithEmail,
    createAccount,
    resetPassword,
    continueAsGuest,
  } = useAuthStore();
  const theme = useUiStore((state) => state.theme);
  const direction = useUiStore((state) => state.direction);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>, successMessage = "", onSuccess?: () => void) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await action();
      setNotice(successMessage);
      onSuccess?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("errors.signIn"));
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(
      () => mode === "signIn"
        ? signInWithEmail(email.trim(), password)
        : createAccount(email.trim(), password),
    );
  };

  return (
    <div className={`workspace-app direction-${direction}`} data-direction={direction} data-theme={theme}>
      <main className="workspace-auth">
        <div className="workspace-auth-shell">
          <section className="workspace-auth-story" aria-label={t("auth.storyLabel")}>
            <button type="button" className="workspace-auth-brand" aria-label="Notez">
              <span><Sparkles size={16} /></span>notez<span>.</span>
            </button>
            <div className="workspace-auth-story-copy">
              <p>{t("auth.eyebrow")}</p>
              <h1>{t("auth.title")}</h1>
              <span>{t("auth.description")}</span>
            </div>
            <div className="workspace-auth-note" aria-hidden="true">
              <span>MONDAY · A NOTE TO SELF</span>
              <strong>Make room<br />for the thought<br /><i>that matters.</i></strong>
              <div><span /><span /><span /></div>
            </div>
            <p className="workspace-auth-story-foot">{t("auth.storyFoot")}</p>
          </section>
          <section className="workspace-auth-card" aria-labelledby="workspace-auth-title">
            <div className="workspace-auth-card-heading">
              <p className="workspace-eyebrow">{mode === "signIn" ? t("auth.welcomeBack") : t("auth.createEyebrow")}</p>
              <h2 id="workspace-auth-title">{mode === "signIn" ? t("auth.signInTitle") : t("auth.createTitle")}</h2>
              <p>{mode === "signIn" ? t("auth.signInDescription") : t("auth.createDescription")}</p>
            </div>
            {error && <p className="workspace-alert" role="alert">{error}</p>}
            {notice && <p className="workspace-auth-notice" role="status">{notice}</p>}
            {setupError ? (
              <div className="workspace-auth-unavailable">
                <p className="workspace-alert" role="status">{setupError}</p>
                <p className="workspace-auth-preview-copy">{t("auth.guestPreviewDescription")}</p>
                <button
                  className="workspace-primary workspace-auth-action"
                  disabled={busy}
                  onClick={() => void run(continueAsGuest, "", () => {
                    navigate(useAuthStore.getState().guestPreview ? "/design/b/library" : "/");
                  })}
                >
                  {busy ? t("auth.working") : t("auth.guestPreview")} <ArrowRight size={15} />
                </button>
              </div>
            ) : (
              <>
                <form className="workspace-auth-form" onSubmit={submit}>
                  <label>
                    <span>{t("auth.email")}</span>
                    <input
                      type="email"
                      name="email"
                      autoComplete="email"
                      placeholder={t("auth.emailPlaceholder")}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                    />
                    <small className="workspace-auth-field-hint">{t("auth.emailHint")}</small>
                  </label>
                  <label>
                    <span>{t("auth.password")}</span>
                    <input
                      type="password"
                      name="password"
                      autoComplete={mode === "signIn" ? "current-password" : "new-password"}
                      placeholder={t("auth.passwordPlaceholder")}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      minLength={6}
                      required
                    />
                  </label>
                  {mode === "signIn" && (
                    <button
                      type="button"
                      className="workspace-auth-text-button"
                      disabled={busy || !email.trim()}
                      onClick={() => void run(() => resetPassword(email.trim()), t("auth.resetSent"))}
                    >
                      {t("auth.forgotPassword")}
                    </button>
                  )}
                  <button className="workspace-primary workspace-auth-action" type="submit" disabled={busy}>
                    {busy ? t("auth.working") : mode === "signIn" ? t("auth.signIn") : t("auth.createAccount")}
                  </button>
                </form>
                <div className="workspace-auth-divider"><span>{t("auth.or")}</span></div>
                <button className="workspace-secondary workspace-auth-action workspace-auth-google" disabled={busy} onClick={() => void run(signInWithGoogle)}>
                  <GoogleMark />{t("auth.google")}
                </button>
                <p className="workspace-auth-switch">
                  {mode === "signIn" ? t("auth.noAccount") : t("auth.haveAccount")}
                  <button type="button" disabled={busy} onClick={() => { setError(""); setNotice(""); setMode(mode === "signIn" ? "signUp" : "signIn"); }}>
                    {mode === "signIn" ? t("auth.createAccount") : t("auth.signIn")}
                  </button>
                </p>
              </>
            )}
            <div className="workspace-auth-bottom">
              <span>{t(setupError ? "auth.previewPrivacy" : "auth.privacy")}</span>
              {!setupError && (
                <button className="workspace-auth-guest" disabled={busy} onClick={() => void run(continueAsGuest)}>
                  {busy ? t("auth.working") : t("auth.guest")} <ArrowRight size={14} />
                </button>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function GoogleMark() {
  return <svg aria-hidden="true" viewBox="0 0 18 18" width="17" height="17">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.17-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.91c1.7-1.56 2.69-3.86 2.69-6.61Z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.81 5.96-2.19l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.34-1.59-5.05-3.73H.94v2.33A9 9 0 0 0 9 18Z" />
    <path fill="#FBBC05" d="M3.95 10.68A5.4 5.4 0 0 1 3.67 9c0-.58.1-1.14.28-1.68V4.99H.94A9 9 0 0 0 .94 13l3.01-2.32Z" />
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.43 1.35l2.57-2.57C13.46.9 11.43 0 9 0A9 9 0 0 0 .94 4.99l3.01 2.33C4.66 5.17 6.65 3.58 9 3.58Z" />
  </svg>;
}

function FolderList({ notes, selected, onSelect, onDrop }: {
  notes: Note[];
  selected: string;
  onSelect: (path: string) => void;
  onDrop: (noteId: string, folder: string) => void;
}) {
  const { t } = useTranslation();
  const folderSignature = useMemo(
    () => notes.map((note) => note.folder_path.trim()).filter(Boolean).sort().join("\u0000"),
    [notes],
  );
  const folders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const path of folderSignature.split("\u0000").filter(Boolean)) {
      const parts = path.split("/").filter(Boolean);
      let current = "";
      for (const part of parts) {
        current += `/${part}`;
        counts.set(current, (counts.get(current) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [folderSignature]);
  const [expanded, setExpanded] = useState<string[]>([]);
  return (
    <nav className="workspace-folders" aria-label={t("nav.folders")}>
      <button className={`workspace-nav-item ${selected === "" ? "is-active" : ""}`} onClick={() => onSelect("")}>
        <BookOpen size={16} /><span>{t("nav.allNotes")}</span><span className="workspace-count">{notes.length}</span>
      </button>
      {folders.map(([path, count]) => {
        const depth = path.split("/").filter(Boolean).length;
        const hasChildren = folders.some(([candidate]) => candidate !== path && candidate.startsWith(`${path}/`));
        const isExpanded = expanded.includes(path);
        const ancestors = path.split("/").filter(Boolean).slice(0, -1).map((_, index, parts) => `/${parts.slice(0, index + 1).join("/")}`);
        if (ancestors.some((ancestor) => !expanded.includes(ancestor))) return null;
        const label = path.split("/").filter(Boolean).slice(-1)[0] ?? path;
        return (
          <div
            className="workspace-folder-row"
            key={path}
            style={{ "--folder-depth": Math.min(depth - 1, 4) } as CSSProperties}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const noteId = event.dataTransfer.getData("text/note-id");
              if (noteId) onDrop(noteId, path);
            }}
          >
            {hasChildren && (
              <button
                type="button"
                className="workspace-folder-toggle"
                aria-label={`${t(isExpanded ? "folders.collapse" : "folders.expand")} ${label}`}
                onClick={() => setExpanded((current) => current.includes(path) ? current.filter((item) => item !== path) : [...current, path])}
              >
                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
            )}
            {!hasChildren && <span className="workspace-folder-toggle-spacer" />}
            <button type="button" className={`workspace-nav-item ${selected === path ? "is-active" : ""}`} onClick={() => onSelect(path)}>
              <Folder size={15} /><span>{label}</span><span className="workspace-count">{count}</span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}

function NoteEditor({ note, ownerId, notes, onClose, onDelete, onStartRecording, onOpenChat, onShare }: {
  note: Note;
  ownerId: string;
  notes: Note[];
  onClose: () => void;
  onDelete: () => void;
  onStartRecording: () => void;
  onOpenChat: () => void;
  onShare: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<NoteInput>({
    title: note.title,
    body: note.body,
    kind: note.kind,
    folder_path: note.folder_path,
    parent_id: note.parent_id,
    note_type: note.note_type,
  });
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [conflict, setConflict] = useState<VersionConflictError | null>(null);
  const [actionError, setActionError] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const dirty = draft.title !== note.title || draft.body !== note.body
    || draft.folder_path !== note.folder_path || draft.kind !== note.kind;
  const childrenQuery = useQuery({
    queryKey: [...noteDetailKey(ownerId, note.id), "children"],
    queryFn: () => getChildren(note.id),
  });
  const parentQuery = useQuery({
    queryKey: noteDetailKey(ownerId, note.parent_id ?? ""),
    queryFn: () => getNote(note.parent_id as string),
    enabled: Boolean(note.parent_id),
  });
  const save = useMutation({
    mutationFn: (version: number = note.version) => updateNote(note.id, version, draft, note),
    onSuccess: async (updated) => {
      queryClient.setQueryData(noteDetailKey(ownerId, updated.id), updated);
      queryClient.setQueryData<Note[]>(noteListKey(ownerId), (current) =>
        current?.map((item) => item.id === updated.id ? updated : item),
      );
      if (!updated.sync_pending && navigator.onLine) {
        await queryClient.invalidateQueries({ queryKey: noteListKey(ownerId) });
      }
      setSaveState("saved");
      setActionError("");
      setConflict(null);
    },
    onError: (error) => {
      if (error instanceof VersionConflictError) setConflict(error);
      setSaveState("error");
      setActionError(error instanceof Error ? error.message : t("errors.saveNote"));
    },
  });

  useEffect(() => {
    setDraft({
      title: note.title,
      body: note.body,
      kind: note.kind,
      folder_path: note.folder_path,
      parent_id: note.parent_id,
      note_type: note.note_type,
    });
    setSaveState("saved");
    setConflict(null);
  }, [note.id]);

  useEffect(() => {
    if (!dirty || conflict) return;
    setSaveState("unsaved");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setSaveState("saving");
      save.mutate(note.version);
    }, 1000);
    return () => window.clearTimeout(timer.current);
  }, [draft, dirty, conflict]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const keepMine = () => {
    if (!conflict) return;
    const version = conflict.currentVersion;
    if (version < 1) return;
    save.mutate(version);
    setConflict(null);
  };

  return (
    <section className="workspace-editor" aria-label={t("editor.noteEditor")}>
      <div className="workspace-editor-toolbar">
        <button className="workspace-back-button" onClick={onClose}><ArrowLeft size={16} /> <span>{t("editor.back")}</span></button>
        <span className={`workspace-save-state save-${saveState}`} role="status">
          {saveState === "saved" && !note.sync_pending ? <Check size={14} /> : saveState === "saving" || note.sync_pending ? <Cloud size={14} /> : null}
          {saveState === "saved" ? (note.sync_pending ? t("sync.waiting") : t("editor.saved")) : saveState === "saving" ? t("editor.saving") : saveState === "error" ? t("editor.saveError") : t("editor.unsaved")}
        </span>
        <div className="workspace-editor-actions">
          <button className="workspace-icon-button" aria-label={t("editor.ask")} onClick={onOpenChat}><Sparkles size={16} /></button>
          <button className="workspace-icon-button" aria-label={t("editor.share")} onClick={onShare}><Share2 size={16} /></button>
          <button className="workspace-secondary" onClick={onStartRecording}><Mic2 size={15} /><span>{t("editor.record")}</span></button>
          <button className="workspace-icon-button" aria-label={t("editor.delete")} onClick={onDelete}><Trash2 size={16} /></button>
        </div>
      </div>

      {conflict && (
        <div className="workspace-conflict" role="alert">
          <div><strong>{t("editor.conflictTitle")}</strong><p>{t("editor.conflictDescription")}</p></div>
          <button className="workspace-secondary" onClick={() => {
            const current = conflict.current as Note | undefined;
            if (current) {
              queryClient.setQueryData(noteDetailKey(ownerId, note.id), current);
              setDraft({ title: current.title, body: current.body, kind: current.kind, folder_path: current.folder_path, parent_id: current.parent_id, note_type: current.note_type });
            }
            setConflict(null);
            void queryClient.invalidateQueries({ queryKey: noteListKey(ownerId) });
          }}>{t("editor.useTheirs")}</button>
          <button className="workspace-primary" onClick={keepMine}>{t("editor.keepMine")}</button>
        </div>
      )}
      {actionError && <p className="workspace-alert" role="alert">{actionError}</p>}

      <div className="workspace-editor-content">
        <div className="workspace-breadcrumb">
          <span>{note.folder_path || t("common.myNotes")}</span>
          {note.parent_id && <><ChevronRight size={13} /><span>{parentQuery.data?.title ?? t("editor.parentNote")}</span></>}
          <ChevronRight size={13} /><span>{note.kind}</span>
        </div>
        <input
          className="workspace-note-title"
          value={draft.title ?? ""}
          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          placeholder={t("editor.titlePlaceholder")}
          aria-label={t("editor.noteTitle")}
          maxLength={500}
        />
        <div className="workspace-note-meta">
          <label>{t("editor.folder")} <input value={draft.folder_path ?? ""} onChange={(event) => setDraft((current) => ({ ...current, folder_path: event.target.value }))} placeholder="/Ideas" /></label>
          <label>{t("editor.kind")} <select value={draft.kind ?? "note"} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value }))}>
            {["note", "idea", "meeting", "reference", "recording"].map((kind) => <option key={kind}>{kind}</option>)}
          </select></label>
        </div>
        <Suspense fallback={<div className="workspace-note-body workspace-editor-loading" aria-busy="true" />}>
          <NoteBodyEditor
            value={draft.body ?? ""}
            notes={notes}
            placeholder={t("editor.bodyPlaceholder")}
            onChange={(body) => setDraft((current) => ({ ...current, body }))}
            onKindChange={(kind) => setDraft((current) => ({ ...current, kind }))}
          />
        </Suspense>
        <div className="workspace-child-notes">
          <div className="workspace-child-heading"><div><p className="workspace-eyebrow">{t("editor.connected")}</p><h2>{t("editor.subnotesTitle")}</h2></div><button className="workspace-secondary" onClick={() => {
            setActionError("");
            void createChildNote(note, queryClient, ownerId, t("editor.depthLimit")).catch((error: unknown) => setActionError(error instanceof Error ? error.message : t("errors.createSubnote")));
          }}><Plus size={14} /> {t("editor.subnote")}</button></div>
          {childrenQuery.data?.map((child) => <button key={child.id} className="workspace-child-link" onClick={() => window.dispatchEvent(new CustomEvent("notez:open-note", { detail: { noteId: child.id } }))}><FilePlus2 size={15} /><span>{child.title || t("editor.titlePlaceholder")}</span><ArrowRight size={14} /></button>)}
          {!childrenQuery.data?.length && <p className="workspace-muted">{t("editor.subnotesEmpty")}</p>}
        </div>
      </div>
    </section>
  );
}

async function createChildNote(parent: Note, queryClient: ReturnType<typeof useQueryClient>, ownerId: string, depthError: string) {
  let depth = 1;
  let ancestorId = parent.parent_id;
  while (ancestorId) {
    if (depth >= 5) throw new Error(depthError);
    const ancestor = await getNote(ancestorId);
    ancestorId = ancestor.parent_id;
    depth += 1;
  }
  if (depth >= 5) throw new Error(depthError);
  const child = await createNote({ title: "", body: "", kind: "note", folder_path: parent.folder_path, parent_id: parent.id });
  if (child.sync_pending) {
    queryClient.setQueryData<Note[]>(noteListKey(ownerId), (current) => [...(current ?? []), child]);
    queryClient.setQueryData(noteDetailKey(ownerId, child.id), child);
  } else {
    await queryClient.invalidateQueries({ queryKey: noteListKey(ownerId) });
  }
  window.dispatchEvent(new CustomEvent("notez:open-note", { detail: { noteId: child.id } }));
}

export default function WorkspaceApp() {
  const { t } = useTranslation();
  const { noteId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const authStatus = useAuthStore((state) => state.status);
  const signInWithGoogle = useAuthStore((state) => state.signInWithGoogle);
  const signOut = useAuthStore((state) => state.signOut);
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const direction = useUiStore((state) => state.direction);
  const setDirection = useUiStore((state) => state.setDirection);
  const language = useUiStore((state) => state.language);
  const setLanguage = useUiStore((state) => state.setLanguage);
  const ownerId = user?.uid ?? "";
  const notesKey = noteListKey(ownerId);
  const offlineSync = useOfflineSync(ownerId || undefined);
  const [search, setSearch] = useState("");
  const [selectedFolder, setSelectedFolder] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{ note: Note; timer: number } | null>(null);
  const paletteInput = useRef<HTMLInputElement>(null);
  const mainContentRef = useRef<HTMLElement>(null);
  const settingsDialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainContentRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);
  useEffect(() => {
    if (!settingsOpen) return;
    const dialog = settingsDialogRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])];
    focusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSettingsOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
      else document.querySelector<HTMLElement>(".workspace-logo")?.focus();
    };
  }, [settingsOpen]);
  useEffect(() => {
    const onOpenNote = (event: Event) => {
      const detail = (event as CustomEvent<{ noteId?: string }>).detail;
      if (detail?.noteId) navigate(`/notes/${detail.noteId}`);
    };
    window.addEventListener("notez:open-note", onOpenNote);
    return () => window.removeEventListener("notez:open-note", onOpenNote);
  }, [navigate]);
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (event.key === "Escape") {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);
  useEffect(() => {
    if (paletteOpen) paletteInput.current?.focus();
    else setSearch("");
  }, [paletteOpen]);
  const previousOwner = useRef<string | null>(null);
  useEffect(() => {
    if (previousOwner.current && previousOwner.current !== user?.uid) {
      queryClient.removeQueries({ queryKey: ["notes", previousOwner.current] });
    }
    previousOwner.current = user?.uid ?? null;
  }, [queryClient, user?.uid]);
  const notesQuery = useQuery({
    queryKey: notesKey,
    queryFn: async () => {
      if (!user?.uid) throw new Error(t("errors.signInRequired"));
      if (!navigator.onLine) {
        const cached = await getCachedNotes(user.uid);
        if (cached === null) throw new Error(t("errors.noOfflineNotes"));
        return cached;
      }
      try {
        const [serverNotes, cachedNotes, queued] = await Promise.all([
          listAllNotes(),
          getCachedNotes(user.uid),
          getQueuedOperations(user.uid),
        ]);
        if (!cachedNotes) return serverNotes;
        const pendingIds = new Set(queued.flatMap((operation) =>
          operation.op === "create" ? [operation.clientId] : operation.noteId ? [operation.noteId] : [],
        ));
        const merged = new Map(serverNotes.map((note) => [note.id, note]));
        for (const note of cachedNotes) {
          if (pendingIds.has(note.id)) merged.set(note.id, note);
        }
        return [...merged.values()];
      } catch (error) {
        if (navigator.onLine && !(error instanceof TypeError)) throw error;
        const cached = await getCachedNotes(user.uid);
        if (cached === null) throw error;
        return cached;
      }
    },
    enabled: authStatus === "ready" && Boolean(user),
    staleTime: 30_000,
  });
  useEffect(() => {
    if (!user?.uid || !notesQuery.data) return;
    void saveCachedNotes(user.uid, notesQuery.data).catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : t("errors.saveOffline"));
    });
  }, [notesQuery.data, user?.uid]);
  const noteQuery = useQuery({
    queryKey: noteDetailKey(ownerId, noteId ?? ""),
    queryFn: () => getNote(noteId as string),
    enabled: authStatus === "ready" && Boolean(user && noteId),
  });
  const createMutation = useMutation({
    mutationFn: createNote,
    onSuccess: async (note) => {
      queryClient.setQueryData(noteDetailKey(ownerId, note.id), note);
      queryClient.setQueryData<Note[]>(notesKey, (current) => [
        note,
        ...(current ?? []).filter((item) => item.id !== note.id),
      ]);
      if (!note.sync_pending && navigator.onLine) await queryClient.invalidateQueries({ queryKey: notesKey });
      navigate(`/notes/${note.id}`);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteNote,
    onSuccess: async (_, id) => {
      queryClient.setQueryData<Note[]>(notesKey, (current) => current?.filter((note) => note.id !== id));
      queryClient.removeQueries({ queryKey: noteDetailKey(ownerId, id) });
      if (navigator.onLine) await queryClient.invalidateQueries({ queryKey: notesKey });
      navigate("/");
      setNotice(t("toast.deleted"));
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : t("errors.deleteNote")),
  });
  const updateFolder = useMutation({
    mutationFn: ({ note, folder }: { note: Note; folder: string }) => updateNote(note.id, note.version, { folder_path: folder }, note),
    onSuccess: (updated) => {
      queryClient.setQueryData(noteDetailKey(ownerId, updated.id), updated);
      queryClient.setQueryData<Note[]>(notesKey, (current) => current?.map((note) => note.id === updated.id ? updated : note));
      if (!updated.sync_pending && navigator.onLine) void queryClient.invalidateQueries({ queryKey: notesKey });
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : t("errors.moveNote")),
  });

  const allNotes = notesQuery.data ?? [];
  const matchingNotes = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return allNotes.filter((note) => {
      const matchesFolder = !selectedFolder || note.folder_path === selectedFolder || note.folder_path.startsWith(`${selectedFolder}/`);
      const matchesSearch = !query || `${note.title} ${note.body} ${note.folder_path}`.toLocaleLowerCase().includes(query);
      return matchesFolder && matchesSearch;
    });
  }, [allNotes, search, selectedFolder]);
  const paletteNotes = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return allNotes.slice(0, 8);
    return allNotes.filter((note) => `${note.title} ${note.body} ${note.folder_path}`.toLocaleLowerCase().includes(query)).slice(0, 8);
  }, [allNotes, search]);
  const activeNote = noteQuery.data ?? allNotes.find((note) => note.id === noteId);

  const newNote = async () => {
    setNotice("");
    try {
      await createMutation.mutateAsync({ title: "", body: "", kind: "note" });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("errors.createNote"));
    }
  };
  const startRecording = async (sourceNote?: Note) => {
    setNotice("");
    try {
      const note = sourceNote
        ? await createNote({ title: `${t("common.recording")} — ${sourceNote.title || t("editor.titlePlaceholder")}`, body: "", kind: "recording", folder_path: sourceNote.folder_path, parent_id: sourceNote.id })
        : await createNote({ title: t("common.recording"), body: "", kind: "recording" });
      queryClient.setQueryData(noteDetailKey(ownerId, note.id), note);
      queryClient.setQueryData<Note[]>(notesKey, (current) => [
        note,
        ...(current ?? []).filter((item) => item.id !== note.id),
      ]);
      if (!note.sync_pending && navigator.onLine) await queryClient.invalidateQueries({ queryKey: notesKey });
      navigate(`/record/${note.id}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("errors.createRecording"));
    }
  };
  const scheduleDelete = (note: Note) => {
    const timer = window.setTimeout(() => {
      setPendingDelete(null);
      deleteMutation.mutate(note.id);
    }, 5000);
    setPendingDelete({ note, timer });
    setNotice(t("errors.deletionScheduled", { title: note.title || t("editor.titlePlaceholder") }));
  };
  const undoDelete = () => {
    if (!pendingDelete) return;
    window.clearTimeout(pendingDelete.timer);
    setPendingDelete(null);
    setNotice(t("errors.deletionCancelled"));
  };
  const share = async () => {
    if (!activeNote) return;
    try {
      const result = await shareNote(activeNote.id);
      await navigator.clipboard.writeText(result.url);
      setNotice(t("errors.shareCopied"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("errors.share"));
    }
  };
  const exportAccount = async () => {
    setExporting(true);
    setNotice("");
    try {
      const data = await apiRequest<Record<string, unknown>>("/v1/account/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `notez-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(t("errors.accountExport"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("errors.export"));
    } finally {
      setExporting(false);
    }
  };

  if (authStatus === "loading") return <main className="workspace-loading" role="status">Opening your workspace…</main>;
  if (!user) return <AuthGate />;

  return (
    <div className={`workspace-app direction-${direction}`} data-direction={direction} data-theme={theme}>
      <header className="workspace-topbar">
        <button className="workspace-menu-button" onClick={() => setMobileMenuOpen((open) => !open)} aria-label={t("errors.toggleNavigation")}><Menu size={19} /></button>
        <button className="workspace-logo" onClick={() => navigate("/")} aria-label={t("errors.home")}><span><Sparkles size={15} /></span>notez<span className="workspace-logo-period">.</span></button>
        <label className="workspace-global-search"><Search size={16} /><input value={search} onFocus={() => setPaletteOpen(true)} onChange={(event) => setSearch(event.target.value)} placeholder={t("library.search")} aria-label={t("library.search")} /><kbd>⌘ K</kbd></label>
        <div className="workspace-top-actions">
          <button className="workspace-icon-button" aria-label={t("errors.toggleAppearance")} onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark")}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button>
          <button className="workspace-icon-button" aria-label={t("errors.settings")} onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button>
          <button className="workspace-user" title={user.email ?? t("common.guest")} aria-expanded={profileOpen} onClick={() => setProfileOpen((open) => !open)}>{(user.displayName ?? user.email ?? "G").slice(0, 1).toUpperCase()}</button>
          {profileOpen && (
            <div className="workspace-profile-menu">
              <strong>{user.displayName ?? (user.isAnonymous ? t("common.guestWorkspace") : user.email)}</strong>
              {user.isAnonymous && <button onClick={() => void signInWithGoogle().then(() => setProfileOpen(false)).catch((error: unknown) => setNotice(error instanceof Error ? error.message : t("errors.linkGoogle")))}>{t("nav.linkGoogle")}</button>}
              <button onClick={() => { setProfileOpen(false); setSettingsOpen(true); }}>{t("settings.title")}</button>
              <button onClick={() => void signOut()}>{t("nav.signOut")}</button>
            </div>
          )}
        </div>
      </header>

      <div className="workspace-layout">
        <aside className={`workspace-sidebar ${mobileMenuOpen ? "workspace-sidebar-open" : ""}`}>
          <div className="workspace-sidebar-heading"><span>{t("nav.space")}</span><button className="workspace-icon-button" aria-label={t("library.newNote")} onClick={() => void newNote()}><Plus size={16} /></button></div>
          <FolderList
            notes={allNotes}
            selected={selectedFolder}
            onSelect={(path) => { setSelectedFolder(path); setMobileMenuOpen(false); navigate("/"); }}
            onDrop={(id, folder) => {
              const dragged = allNotes.find((note) => note.id === id);
              if (dragged) updateFolder.mutate({ note: dragged, folder });
            }}
          />
          <div className="workspace-sidebar-spacer" />
          <div className="workspace-sidebar-footer">
            <span className="workspace-avatar">{(user.displayName ?? user.email ?? "G").slice(0, 1).toUpperCase()}</span>
            <span className="workspace-user-copy"><strong>{user.displayName ?? (user.isAnonymous ? t("common.guest") : user.email)}</strong><small>{user.isAnonymous ? t("common.guestWorkspace") : t("common.private")}</small></span>
            <span className={`workspace-online-dot ${navigator.onLine ? "" : "is-offline"}`} title={navigator.onLine ? t("errors.online") : t("errors.offline")} />
            {(offlineSync.pendingCount > 0 || offlineSync.syncing) && (
              <span className="workspace-sync-count" role="status">
                {offlineSync.syncing ? t("sync.syncing") : t("sync.pendingCount", { count: offlineSync.pendingCount })}
              </span>
            )}
          </div>
        </aside>

        <main ref={mainContentRef} className={`workspace-main ${noteId ? "workspace-main-editor" : ""}`}>
          {!noteId ? (
            <section className="workspace-library">
              <div className="workspace-welcome">
                <div><p className="workspace-eyebrow">{t("library.eyebrow")}</p><h1>{t("library.title")}</h1><p>{t("library.description")}</p></div>
                <div className="workspace-welcome-actions">
                  <button className="workspace-secondary" onClick={() => void startRecording()}><Mic2 size={15} /> {t("editor.record")}</button>
                  <button className="workspace-primary" onClick={() => void newNote()} disabled={createMutation.isPending}><Plus size={16} /> {t("library.newNote")}</button>
                </div>
              </div>
              <div className="workspace-library-toolbar"><span>{selectedFolder || t("library.allThoughts")} <small>{matchingNotes.length}</small></span><button className="workspace-chat-trigger" onClick={() => setChatOpen(true)}><Sparkles size={15} /> {t("library.ask")}</button></div>
              {notesQuery.isPending ? <div className="workspace-empty-state">{t("library.gathering")}</div> : notesQuery.error ? (
                <div className="workspace-empty-state workspace-error-state" role="alert">
                  <h2>{t("errors.library")}</h2><p>{notesQuery.error instanceof Error ? notesQuery.error.message : t("errors.retry")}</p>
                  <button className="workspace-secondary" onClick={() => void notesQuery.refetch()}>{t("errors.retry")}</button>
                </div>
              ) : matchingNotes.length ? (
                <div className="workspace-note-grid">
                  {matchingNotes.map((note) => (
                    <button
                      key={note.id}
                      className="workspace-note-card"
                      draggable
                      onDragStart={(event) => event.dataTransfer.setData("text/note-id", note.id)}
                      onClick={() => navigate(`/notes/${note.id}`)}
                    >
                      <span className="workspace-card-meta"><span className="workspace-kind"><i />{note.kind}</span><time>{new Date(note.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time></span>
                      <strong>{note.title || t("editor.titlePlaceholder")}</strong>
                      <p>{note.body.slice(0, 170) || t("errors.freshThought")}</p>
                      <span className="workspace-card-folder"><Folder size={12} />{note.folder_path || t("common.myNotes")}<ArrowRight size={14} /></span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="workspace-empty-state">
                  <span className="workspace-empty-icon"><BookOpen size={22} /></span>
                  <p className="workspace-eyebrow">{t("library.emptyEyebrow")}</p>
                  <h2>{t("library.emptyTitle")}</h2>
                  <p>{t("library.emptyDescription")}</p>
                  <div><button className="workspace-primary" onClick={() => void newNote()}><Plus size={15} /> {t("library.writeNote")}</button><button className="workspace-secondary" onClick={() => void startRecording()}><Mic2 size={15} /> {t("editor.record")}</button></div>
                </div>
              )}
            </section>
          ) : noteQuery.isPending && !activeNote ? <div className="workspace-empty-state">{t("library.gathering")}</div> : (noteQuery.error && !activeNote) || !activeNote ? (
            <div className="workspace-empty-state workspace-error-state" role="alert"><h2>{t("errors.note")}</h2><p>{noteQuery.error instanceof Error ? noteQuery.error.message : t("errors.notFound")}</p><button className="workspace-secondary" onClick={() => navigate("/")}><ArrowLeft size={14} /> {t("editor.back")}</button></div>
          ) : (
            <NoteEditor
              key={activeNote.id}
              note={activeNote}
              ownerId={ownerId}
              notes={allNotes}
              onClose={() => navigate("/")}
              onDelete={() => scheduleDelete(activeNote)}
              onStartRecording={() => void startRecording(activeNote)}
              onOpenChat={() => setChatOpen(true)}
              onShare={() => void share()}
            />
          )}
        </main>

        {chatOpen && (
          <div className="workspace-chat-dock">
            <ChatPanel
              noteId={activeNote?.id}
              onClose={() => setChatOpen(false)}
              onOpenNote={(id) => navigate(`/notes/${id}`)}
              onCreateNote={() => void queryClient.invalidateQueries({ queryKey: notesKey })}
            />
          </div>
        )}
      </div>

      <nav className="workspace-mobile-nav" aria-label={t("nav.space")}>
        <button className={!noteId ? "is-active" : ""} onClick={() => navigate("/")}><BookOpen size={18} /><span>{t("nav.library")}</span></button>
        <button className={noteId ? "is-active" : ""} onClick={() => activeNote ? navigate(`/notes/${activeNote.id}`) : void newNote()}><FilePlus2 size={18} /><span>{t("nav.note")}</span></button>
        <button onClick={() => void startRecording()}><Mic2 size={18} /><span>{t("nav.record")}</span></button>
        <button className={chatOpen ? "is-active" : ""} onClick={() => setChatOpen((open) => !open)}><Sparkles size={18} /><span>{t("nav.ask")}</span></button>
      </nav>
      {notice && (
        <div className="workspace-toast" role="status">
          <span>{notice}</span>
          {pendingDelete && <button onClick={undoDelete}>Undo</button>}
          {!pendingDelete && <button aria-label={t("errors.dismiss")} onClick={() => setNotice("")}><X size={14} /></button>}
        </div>
      )}
      {offlineSync.syncError && (
        <div className="workspace-sync-error" role="status">
          <span>{offlineSync.syncError}</span>
          {navigator.onLine && <button className="workspace-secondary" onClick={() => void offlineSync.sync()}>{t("sync.retry")}</button>}
        </div>
      )}
      {offlineSync.conflict && (
        <div className="workspace-command-backdrop">
          <section className="workspace-conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="sync-conflict-title">
            <header><p className="workspace-eyebrow">{t("sync.conflictEyebrow")}</p><h2 id="sync-conflict-title">{t("sync.conflictTitle")}</h2><p>{t("sync.conflictDescription")}</p></header>
            <div className="workspace-conflict-columns">
              <article><h3>{t("sync.yourVersion")}</h3><strong>{offlineSync.conflict.mine?.title || t("editor.titlePlaceholder")}</strong><p>{offlineSync.conflict.mine?.body || offlineSync.conflict.operation.fields.body || ""}</p></article>
              <article><h3>{t("sync.serverVersion")}</h3><strong>{offlineSync.conflict.theirs.title || t("editor.titlePlaceholder")}</strong><p>{offlineSync.conflict.theirs.body}</p></article>
            </div>
            <footer>
              <button className="workspace-secondary" onClick={() => void offlineSync.useTheirs().catch((error: unknown) => setNotice(error instanceof Error ? error.message : t("sync.useServerError")))}>{t("editor.useTheirs")}</button>
              <button className="workspace-primary" onClick={() => void offlineSync.keepMine().catch((error: unknown) => setNotice(error instanceof Error ? error.message : t("sync.keepMineError")))}>{t("editor.keepMine")}</button>
            </footer>
          </section>
        </div>
      )}
      {paletteOpen && (
        <div className="workspace-command-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPaletteOpen(false);
        }}>
          <section className="workspace-command-palette" role="dialog" aria-modal="true" aria-label={t("search.placeholder")}>
            <label className="workspace-command-search"><Search size={17} /><input ref={paletteInput} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("search.placeholder")} /><button onClick={() => setPaletteOpen(false)} aria-label={t("errors.close")}><X size={15} /></button></label>
            <div className="workspace-command-list">
              <p>{t("search.actions")}</p>
              <button onClick={() => { setPaletteOpen(false); void newNote(); }}><Plus size={15} /><span>{t("search.create")}</span><kbd>↵</kbd></button>
              <button onClick={() => { setPaletteOpen(false); void startRecording(); }}><Mic2 size={15} /><span>{t("search.record")}</span></button>
              <button onClick={() => { setPaletteOpen(false); setChatOpen(true); }}><Sparkles size={15} /><span>{t("search.ask")}</span></button>
              {paletteNotes.length > 0 && <p>{t("search.notes")}</p>}
              {paletteNotes.map((note) => <button key={note.id} onClick={() => { setPaletteOpen(false); navigate(`/notes/${note.id}`); }}><FilePlus2 size={15} /><span>{note.title || t("editor.titlePlaceholder")}</span><small>{note.folder_path || t("common.myNotes")}</small></button>)}
              {!paletteNotes.length && search && <div className="workspace-command-empty">{t("search.empty")}</div>}
            </div>
          </section>
        </div>
      )}
      {settingsOpen && (
        <div className="workspace-command-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSettingsOpen(false);
        }}>
          <section ref={settingsDialogRef} className="workspace-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-settings-title" tabIndex={-1}>
            <header><div><p className="workspace-eyebrow">{t("settings.eyebrow")}</p><h2 id="workspace-settings-title">{t("settings.title")}</h2></div><button className="workspace-icon-button" aria-label={t("errors.close")} onClick={() => setSettingsOpen(false)}><X size={16} /></button></header>
            <p>{t("settings.description")}</p>
            <div className="workspace-theme-options">
              {(["light", "dark", "system"] as const).map((choice) => (
                <button key={choice} aria-pressed={theme === choice} className={theme === choice ? "is-selected" : ""} onClick={() => setTheme(choice)}>
                  {choice === "light" ? <Sun size={16} /> : choice === "dark" ? <Moon size={16} /> : <Cloud size={16} />}
                  <span>{t(`settings.${choice}`)}</span>
                  {theme === choice && <Check size={14} />}
                </button>
              ))}
            </div>
            <div className="workspace-direction-setting">
              <span>{t("settings.direction")}</span>
              <div className="workspace-direction-options" role="group" aria-label={t("settings.direction")}>
                {([
                  ["a", "precision", Command],
                  ["b", "workspace", Layers3],
                  ["c", "graph", Network],
                ] as const).map(([choice, label, Icon]) => (
                  <button
                    key={choice}
                    type="button"
                    aria-pressed={direction === choice}
                    className={direction === choice ? "is-selected" : ""}
                    onClick={() => setDirection(choice)}
                  >
                    <Icon size={15} />
                    <span>{t(`settings.${label}`)}</span>
                  </button>
                ))}
              </div>
            </div>
            <label className="workspace-language-select">{t("settings.language")}
              <select value={language} onChange={(event) => setLanguage(event.target.value as LanguageChoice)}>
                <option value="en">English</option>
                <option value="ur">اردو</option>
                <option value="hi">हिन्दी</option>
              </select>
            </label>
            <div className="workspace-export-row">
              <div><strong>{t("settings.takeNotes")}</strong><p>{t("settings.exportDescription")}</p></div>
              <button className="workspace-secondary" disabled={exporting} onClick={() => void exportAccount()}><FileDown size={14} />{exporting ? t("settings.preparing") : t("settings.export")}</button>
            </div>
          </section>
        </div>
      )}
      {pendingDelete && <span className="workspace-visually-hidden">{t("errors.deletionScheduled", { title: pendingDelete.note.title })}</span>}
      {deleteMutation.isPending && <span className="workspace-visually-hidden" role="status">{t("toast.deleting")}</span>}
    </div>
  );
}
