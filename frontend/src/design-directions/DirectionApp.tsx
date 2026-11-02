import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowDownLeft, ArrowLeft, ArrowRight, AudioLines, BookOpen, Check, ChevronDown, ChevronRight,
  Copy, FileText, Folder, FolderOpen, HelpCircle, Home, Library, Link2, Menu, Mic2, MoreHorizontal,
  PanelRightClose, Plus, Printer, Search, Settings2, ShieldCheck, Sparkles, Star, X,
} from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { notes, type NoteFixture } from "./fixtures/notes";
import { recording } from "./fixtures/recording";
import { conversation, type ChatTurn } from "./fixtures/chat";
import { urduSample } from "./fixtures/urdu-sample";
import { useUiStore, type MotionPreference, type ReaderTextSize, type ReaderWidth, type ThemeChoice } from "../store/ui";

type Direction = "a" | "b" | "c";
type Screen = "library" | "note" | "recording" | "chat" | "settings" | "urdu";

const directionMeta: Record<Direction, { name: string; tagline: string; marker: string }> = {
  a: { name: "Precision", tagline: "A little less noise.", marker: "A" },
  b: { name: "Workspace", tagline: "Room to think.", marker: "B" },
  c: { name: "Graph", tagline: "Ideas in orbit.", marker: "C" },
};

const screenLabels: Record<Screen, string> = {
  library: "Library",
  note: "Note",
  recording: "Recording",
  chat: "Ask your notes",
  settings: "Appearance",
  urdu: "Urdu sample",
};

const icons = {
  library: Home,
  recording: AudioLines,
  chat: Sparkles,
  settings: Settings2,
} satisfies Record<"library" | "recording" | "chat" | "settings", typeof Home>;

function isDirection(value: string | undefined): value is Direction {
  return value === "a" || value === "b" || value === "c";
}

function routeFor(direction: Direction, screen: Screen, noteId?: string) {
  if (screen === "note" && noteId) return `/design/${direction}/note/${noteId}`;
  return `/design/${direction}/${screen}`;
}

export function DirectionApp() {
  const { direction: rawDirection } = useParams();
  const direction = isDirection(rawDirection) ? rawDirection : "a";
  const meta = directionMeta[direction];
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const motionPreference = useUiStore((state) => state.motionPreference);
  const setMotionPreference = useUiStore((state) => state.setMotionPreference);
  const readerTextSize = useUiStore((state) => state.readerTextSize);
  const setReaderTextSize = useUiStore((state) => state.setReaderTextSize);
  const readerWidth = useUiStore((state) => state.readerWidth);
  const setReaderWidth = useUiStore((state) => state.setReaderWidth);
  const favoriteNoteIds = useUiStore((state) => state.favoriteNoteIds);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [selectedFolder, setSelectedFolder] = useState("");
  const [emptyLibrary, setEmptyLibrary] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [readingFocus, setReadingFocus] = useState(false);
  const paletteInput = useRef<HTMLInputElement>(null);
  const mainContentRef = useRef<HTMLElement>(null);

  const segments = location.pathname.split("/").filter(Boolean).slice(2);
  const routeScreen = segments[0] || "library";
  const screen: Screen = routeScreen === "note"
    ? "note"
    : routeScreen === "recording" || routeScreen === "chat" || routeScreen === "settings" || routeScreen === "urdu"
      ? routeScreen
      : "library";
  const activeNoteId = screen === "note" ? segments[1] : undefined;
  const activeNote = notes.find((note) => note.id === activeNoteId) ?? notes[0];

  useEffect(() => {
    mainContentRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (event.key === "Escape") {
        setPaletteOpen(false);
        setReadingFocus(false);
      }
      const target = event.target;
      const isTyping = target instanceof HTMLElement
        && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (!isTyping && screen === "note" && !event.metaKey && !event.ctrlKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setReadingFocus((focus) => !focus);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [screen]);

  useEffect(() => {
    if (screen !== "note") setReadingFocus(false);
  }, [screen]);

  useEffect(() => {
    if (paletteOpen) paletteInput.current?.focus();
    else setPaletteQuery("");
  }, [paletteOpen]);

  const openScreen = (nextScreen: Screen) => {
    navigate(routeFor(direction, nextScreen));
    setPaletteOpen(false);
    setMobileMenuOpen(false);
  };
  const openNote = (noteId: string) => {
    navigate(routeFor(direction, "note", noteId));
    setPaletteOpen(false);
  };

  const folderFilteredNotes = useMemo(
    () => notes.filter((note) => !selectedFolder || note.folder.startsWith(selectedFolder)),
    [selectedFolder],
  );

  return (
    <div
      className={`direction-app direction-${direction} ${readingFocus && screen === "note" ? "reading-focus-active" : ""}`}
      data-direction={direction}
      data-theme={theme}
      data-reduced-motion={motionPreference === "reduced" ? "true" : undefined}
    >
      <header className="app-topbar">
        <div className="topbar-leading">
          <LinkHome />
          <span className="topbar-divider" />
          <span className="direction-name"><span className="direction-marker">{meta.marker}</span>{meta.name}</span>
          <span className="mode-label">{meta.tagline}</span>
        </div>
        <div className="topbar-actions">
          <button className="topbar-search" onClick={() => setPaletteOpen(true)} aria-label="Open command palette">
            <Search size={15} /><span>Search notes</span><kbd>⌘ K</kbd>
          </button>
          <button className="icon-button mobile-menu-button" onClick={() => setMobileMenuOpen((open) => !open)} aria-label="Toggle navigation">
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <Link className="back-compare" to="/design"><ArrowLeft size={14} /> Compare</Link>
          <button className="avatar-button" aria-label="Profile">S</button>
        </div>
      </header>

      <div className="app-frame">
        <aside className={`app-sidebar ${mobileMenuOpen ? "sidebar-open" : ""}`}>
          <div className="sidebar-workspace">
            <div className="workspace-avatar"><Sparkles size={15} /></div>
            <div className="workspace-copy"><strong>Shan's space</strong><span>Personal workspace</span></div>
            <button className="quiet-icon-button" aria-label="Workspace menu"><MoreHorizontal size={17} /></button>
          </div>
          <nav className="primary-nav" aria-label="Primary">
            {(["library", "recording", "chat"] as const).map((item) => {
              const Icon = icons[item];
              return (
                <button key={item} className={`nav-item ${screen === item || (item === "library" && screen === "note") ? "nav-item-active" : ""}`} onClick={() => openScreen(item)}>
                  <Icon size={16} strokeWidth={1.8} /><span>{item === "chat" ? "Ask AI" : screenLabels[item]}</span>
                  {item === "chat" && <span className="nav-ai-mark">AI</span>}
                </button>
              );
            })}
          </nav>
          <div className="sidebar-section-heading">
            <span>YOUR LIBRARY</span>
            <button className="quiet-icon-button" aria-label="Add folder"><Plus size={15} /></button>
          </div>
          <FolderTree selected={selectedFolder} onSelect={setSelectedFolder} />
          <div className="sidebar-spacer" />
          <button className={`nav-item ${screen === "urdu" ? "nav-item-active" : ""}`} onClick={() => openScreen("urdu")}>
            <span className="language-glyph">ع</span><span>Urdu sample</span><span className="rtl-tag">RTL</span>
          </button>
          <button className={`nav-item ${screen === "settings" ? "nav-item-active" : ""}`} onClick={() => openScreen("settings")}>
            <Settings2 size={16} strokeWidth={1.8} /><span>Settings</span>
          </button>
          <div className="sidebar-profile">
            <span className="profile-dot">S</span><span>Shan</span><span className="online-dot" />
          </div>
        </aside>

        <main ref={mainContentRef} className={`main-content screen-${screen}`}>
          <div className="mobile-back-row">
            <button onClick={() => setMobileMenuOpen((open) => !open)} className="quiet-icon-button"><Menu size={17} /></button>
            <span>{screenLabels[screen]}</span>
            <button className="quiet-icon-button" onClick={() => setPaletteOpen(true)}><Search size={17} /></button>
          </div>
          {screen === "library" && (
            <LibraryScreen
              notes={folderFilteredNotes}
              favoriteNoteIds={favoriteNoteIds}
              empty={emptyLibrary}
              selectedFolder={selectedFolder}
              onToggleEmpty={() => setEmptyLibrary((empty) => !empty)}
              onOpenNote={openNote}
              onOpenScreen={openScreen}
              direction={direction}
            />
          )}
          {screen === "note" && (
            <NoteScreen
              note={activeNote}
              onOpenNote={openNote}
              onBack={() => openScreen("library")}
              direction={direction}
              readerTextSize={readerTextSize}
              readerWidth={readerWidth}
              readingFocus={readingFocus}
              onToggleReadingFocus={() => setReadingFocus((focus) => !focus)}
            />
          )}
          {screen === "recording" && <RecordingScreen />}
          {screen === "chat" && <ChatScreen onOpenNote={openNote} />}
          {screen === "settings" && (
            <SettingsScreen
              theme={theme}
              setTheme={setTheme}
              direction={direction}
              motionPreference={motionPreference}
              setMotionPreference={setMotionPreference}
              readerTextSize={readerTextSize}
              setReaderTextSize={setReaderTextSize}
              readerWidth={readerWidth}
              setReaderWidth={setReaderWidth}
              onOpenUrdu={() => openScreen("urdu")}
              onOpenDirections={() => navigate("/design")}
            />
          )}
          {screen === "urdu" && <UrduScreen onOpenNote={openNote} onBack={() => openScreen("library")} />}
        </main>

        {(screen === "library" || screen === "note") && (
          <ChatAside onOpenChat={() => openScreen("chat")} onOpenNote={openNote} />
        )}
      </div>

      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <button className={screen === "library" || screen === "note" ? "mobile-nav-active" : ""} onClick={() => openScreen("library")}><Library size={18} /><span>Library</span></button>
        <button className={screen === "note" ? "mobile-nav-active" : ""} onClick={() => openNote(activeNote.id)}><FileText size={18} /><span>Note</span></button>
        <button className={screen === "recording" ? "mobile-nav-active" : ""} onClick={() => openScreen("recording")}><Mic2 size={18} /><span>Record</span></button>
        <button className={screen === "chat" ? "mobile-nav-active" : ""} onClick={() => openScreen("chat")}><Sparkles size={18} /><span>AI</span></button>
      </nav>

      {paletteOpen && (
        <div className="palette-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPaletteOpen(false);
        }}>
          <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
            <div className="palette-search-row">
              <Search size={17} />
              <input ref={paletteInput} value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder="Search notes, or jump to…" />
              <button onClick={() => setPaletteOpen(false)} aria-label="Close command palette"><kbd>ESC</kbd><X size={14} /></button>
            </div>
            <PaletteResults query={paletteQuery} onOpenNote={openNote} onOpenScreen={openScreen} />
            <div className="palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span><span><kbd>↵</kbd> to open</span><span>SEARCH YOUR SPACE</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

function LinkHome() {
  return <Link className="app-brand" to="/design" aria-label="Back to directions"><span className="app-brand-icon"><Sparkles size={14} /></span><span>notez<span>.</span></span></Link>;
}

function FolderTree({ selected, onSelect }: { selected: string; onSelect: (folder: string) => void }) {
  const [expanded, setExpanded] = useState<string[]>(["Studio", "Library", "Life"]);
  const folders = useMemo(() => {
    const tree = new Map<string, { count: number; children: Map<string, number> }>();
    notes.forEach((note) => {
      const [root, child] = note.folder.split(" / ");
      const current = tree.get(root) ?? { count: 0, children: new Map<string, number>() };
      current.count += 1;
      current.children.set(child, (current.children.get(child) ?? 0) + 1);
      tree.set(root, current);
    });
    return [...tree.entries()];
  }, []);
  const toggle = (name: string) => setExpanded((open) => open.includes(name) ? open.filter((item) => item !== name) : [...open, name]);

  return (
    <div className="folder-tree">
      {folders.map(([root, data]) => {
        const isExpanded = expanded.includes(root);
        return (
          <div className="folder-root" key={root}>
            <button className={`folder-row ${selected === root ? "folder-selected" : ""}`} onClick={() => { onSelect(selected === root ? "" : root); toggle(root); }}>
              <span className="folder-chevron">{isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
              {isExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}
              <span className="folder-label">{root}</span>
              <span className="folder-count">{data.count}</span>
            </button>
            {isExpanded && [...data.children.entries()].map(([child, count]) => {
              const path = `${root} / ${child}`;
              return (
                <button key={path} className={`folder-row folder-child ${selected === path ? "folder-selected" : ""}`} onClick={() => onSelect(selected === path ? "" : path)}>
                  <span className="folder-child-indent" />
                  <Folder size={14} />
                  <span className="folder-label">{child}</span>
                  <span className="folder-count">{count}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function ScreenHeader({ eyebrow, title, description, trailing }: { eyebrow?: string; title: string; description?: string; trailing?: ReactNode }) {
  return (
    <div className="screen-heading">
      <div>
        {eyebrow && <div className="screen-eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {trailing && <div className="screen-heading-trailing">{trailing}</div>}
    </div>
  );
}

function LibraryScreen({
  notes: visibleNotes, favoriteNoteIds, empty, selectedFolder, onToggleEmpty, onOpenNote, onOpenScreen, direction,
}: {
  notes: NoteFixture[];
  favoriteNoteIds: string[];
  empty: boolean;
  selectedFolder: string;
  onToggleEmpty: () => void;
  onOpenNote: (id: string) => void;
  onOpenScreen: (screen: Screen) => void;
  direction: Direction;
}) {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "saved">("all");
  const notesToShow = activeTab === "saved"
    ? visibleNotes.filter((note) => favoriteNoteIds.includes(note.id))
    : visibleNotes;
  const filteredNotes = notesToShow.filter((note) => note.title.toLowerCase().includes(query.toLowerCase()) || note.excerpt.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="library-page page-in">
      <div className="library-welcome">
        <div>
          <div className="welcome-date">MONDAY, NOVEMBER 02 <span>·</span> YOUR LIBRARY</div>
          <h1>{selectedFolder || "A place for your thoughts"}</h1>
          <p>Keep the things you want to remember close.</p>
        </div>
        <div className="welcome-actions">
          <button className="subtle-button" onClick={onToggleEmpty}>{empty ? "Show your library" : "Preview empty state"}</button>
          <button className="primary-button" onClick={() => onOpenNote("quiet-systems")}><Plus size={16} /> New note</button>
        </div>
      </div>
      {empty ? (
        <div className="empty-library">
          <div className="empty-art">
            <span className="empty-art-sheet sheet-back" /><span className="empty-art-sheet sheet-front"><span /><span /><span /></span>
            <span className="empty-art-star">✳</span>
          </div>
          <div className="empty-kicker">A LITTLE SPACE, JUST FOR YOU</div>
          <h2>Every good thought starts somewhere.</h2>
          <p>This is your place to collect ideas, questions, and moments worth keeping. Your first note doesn't need to be perfect.</p>
          <button className="primary-button" onClick={() => onOpenNote("quiet-systems")}><Plus size={16} /> Write your first note</button>
          <button className="text-button" onClick={() => onOpenScreen("recording")}><Mic2 size={14} /> Or capture a conversation</button>
        </div>
      ) : (
        <>
          <div className="library-tools">
            <div className="library-tabs" aria-label="Library views">
              <button type="button" aria-pressed={activeTab === "all"} className={`library-tab ${activeTab === "all" ? "tab-active" : ""}`} onClick={() => setActiveTab("all")}>All notes <span>{visibleNotes.length}</span></button>
              <button type="button" aria-pressed={activeTab === "saved"} className={`library-tab ${activeTab === "saved" ? "tab-active" : ""}`} onClick={() => setActiveTab("saved")}>Saved <span>{visibleNotes.filter((note) => favoriteNoteIds.includes(note.id)).length}</span></button>
              <button type="button" className="library-tab" onClick={() => onOpenScreen("recording")}>Recordings</button>
              <button type="button" className="library-tab" onClick={() => onOpenScreen("chat")}>Recent AI</button>
            </div>
            <label className="inline-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter this view" /></label>
          </div>
          <div className={`note-grid grid-${direction}`}>
            {filteredNotes.map((note, index) => (
              <button className={`note-card note-card-${note.kind}`} key={note.id} onClick={() => onOpenNote(note.id)} style={{ animationDelay: `${index * 24}ms` }}>
                <div className="note-card-meta"><span className="note-type"><span className={`type-dot type-${note.kind}`} />{note.kind}</span>{favoriteNoteIds.includes(note.id) && <span className="note-card-saved"><Star size={11} fill="currentColor" /> Saved</span>}<span>{note.updated}</span></div>
                <h2>{note.title}</h2>
                <p>{note.excerpt}</p>
                <div className="note-card-bottom"><span><Folder size={12} />{note.folder}</span><ArrowRight size={14} className="note-card-arrow" /></div>
              </button>
            ))}
            {filteredNotes.length === 0 && (
              <div className="no-results">
                {activeTab === "saved" && favoriteNoteIds.length === 0
                  ? <>No saved notes yet. Open a note and select <Star size={12} /> to keep it close.</>
                  : "No notes match this view. Try another word or switch tabs."}
              </div>
            )}
          </div>
        </>
      )}
      <div className="library-footnote"><span><Sparkles size={13} /> Your notes are yours. Always.</span><span>{empty ? "EMPTY STATE PREVIEW" : `${filteredNotes.length} NOTES · MOCK LIBRARY`}</span></div>
    </div>
  );
}

function NoteScreen({
  note,
  onOpenNote,
  onBack,
  direction,
  readerTextSize,
  readerWidth,
  readingFocus,
  onToggleReadingFocus,
}: {
  note: NoteFixture;
  onOpenNote: (id: string) => void;
  onBack: () => void;
  direction: Direction;
  readerTextSize: ReaderTextSize;
  readerWidth: ReaderWidth;
  readingFocus: boolean;
  onToggleReadingFocus: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body.join("\n\n"));
  const [notice, setNotice] = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const isFavorite = useUiStore((state) => state.favoriteNoteIds.includes(note.id));
  const toggleFavoriteNote = useUiStore((state) => state.toggleFavoriteNote);
  const readMinutes = Math.max(1, Math.ceil(body.trim().split(/\s+/).filter(Boolean).length / 220));
  const excerpt = body.split(/\n\s*\n/).find((block) => !block.startsWith("#"))?.replace(/\s+/g, " ").trim() ?? note.excerpt;

  useEffect(() => {
    setTitle(note.title);
    setBody(note.body.join("\n\n"));
    setEditing(false);
    setActionsOpen(false);
    setNotice("");
    setHasUnsavedChanges(false);
    try {
      const saved = localStorage.getItem(`notez-preview-note-${note.id}`);
      if (!saved) return;
      const parsed: unknown = JSON.parse(saved);
      if (
        typeof parsed === "object"
        && parsed !== null
        && "title" in parsed
        && typeof parsed.title === "string"
        && "body" in parsed
        && typeof parsed.body === "string"
      ) {
        setTitle(parsed.title);
        setBody(parsed.body);
      }
    } catch {
      setNotice("This sample note could not be loaded from this browser.");
    }
  }, [note]);

  const saveDraft = () => {
    try {
      localStorage.setItem(`notez-preview-note-${note.id}`, JSON.stringify({ title, body }));
      setEditing(false);
      setHasUnsavedChanges(false);
      setNotice("Changes saved in this browser preview.");
    } catch {
      setNotice("Could not save this sample note in this browser.");
    }
  };

  const resetDraft = () => {
    try {
      localStorage.removeItem(`notez-preview-note-${note.id}`);
      setTitle(note.title);
      setBody(note.body.join("\n\n"));
      setEditing(false);
      setHasUnsavedChanges(false);
      setActionsOpen(false);
      setNotice("Sample note restored.");
    } catch {
      setNotice("Could not restore this sample note.");
    }
  };

  const copyLink = () => {
    setActionsOpen(false);
    if (!navigator.clipboard) {
      setNotice("Clipboard access is unavailable in this browser.");
      return;
    }
    void navigator.clipboard.writeText(window.location.href).then(
      () => setNotice("Note link copied."),
      () => setNotice("Could not copy the note link."),
    );
  };

  return (
    <article className={`note-page page-in ${direction === "b" ? "note-page-editorial" : ""} reader-size-${readerTextSize} reader-width-${readerWidth} ${readingFocus ? "note-focus-mode" : ""}`}>
      <div className="note-breadcrumb"><button onClick={onBack}><ArrowLeft size={13} /> Library</button><ChevronRight size={13} /><span>{note.folder}</span><ChevronRight size={13} /><span className="breadcrumb-current">{title}</span></div>
      <div className="note-toolbar">
        <span className={`saved-indicator ${editing && hasUnsavedChanges ? "note-unsaved" : ""}`}>
          {editing && hasUnsavedChanges ? null : notice ? <Check size={13} /> : <FileText size={13} />}
          {editing ? (hasUnsavedChanges ? "Unsaved changes" : "Editing sample note") : notice || "Sample note · local preview"}
        </span>
        <div className="note-toolbar-actions">
          <button type="button" className={`subtle-button note-focus-toggle ${readingFocus ? "note-focus-toggle-active" : ""}`} onClick={onToggleReadingFocus} aria-pressed={readingFocus} aria-label={readingFocus ? "Exit focus mode" : "Enter focus mode"}>
            <BookOpen size={14} /><span>{readingFocus ? "Exit focus" : "Focus"}</span><kbd>F</kbd>
          </button>
          <button className={`icon-button note-save-button ${isFavorite ? "note-save-button-active" : ""}`} onClick={() => toggleFavoriteNote(note.id)} aria-label={isFavorite ? "Remove from saved notes" : "Save note"} aria-pressed={isFavorite}>
            <Star size={15} fill={isFavorite ? "currentColor" : "none"} />
          </button>
          <button className="subtle-button" onClick={() => editing ? saveDraft() : (setEditing(true), setNotice(""))}>{editing ? "Save changes" : "Edit note"}</button>
          <div className="note-actions-menu">
            <button className="icon-button" aria-label="More note actions" aria-expanded={actionsOpen} onClick={() => setActionsOpen((open) => !open)}><MoreHorizontal size={17} /></button>
            {actionsOpen && (
              <div className="note-actions-popover" role="menu" aria-label="Note actions">
                <button role="menuitem" onClick={copyLink}><Copy size={14} /> Copy note link</button>
                <button role="menuitem" onClick={() => { setActionsOpen(false); window.print(); }}><Printer size={14} /> Print note</button>
                <button role="menuitem" onClick={resetDraft}><X size={14} /> Restore sample content</button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="note-article">
        <div className="note-kind-label"><span className={`type-dot type-${note.kind}`} /> {note.kind.toUpperCase()} <span>·</span> {note.updated.toUpperCase()}</div>
        {editing
          ? <input className="note-title-input" aria-label="Sample note title" value={title} onChange={(event) => { setTitle(event.target.value); setHasUnsavedChanges(true); }} maxLength={200} />
          : <h1>{title}</h1>}
        <div className="note-lede">{excerpt}</div>
        {editing
          ? <textarea className="note-body-editor" aria-label="Sample note content" value={body} onChange={(event) => { setBody(event.target.value); setHasUnsavedChanges(true); }} />
          : <NoteBodyPreview body={body} />}
        {notice && <p className="note-feedback" role="status">{notice}</p>}
        <div className="linked-notes">
          <div className="linked-notes-heading"><Link2 size={14} /><span>CONNECTED NOTES</span><span className="connected-count">{(note.children?.length ?? 0) + (note.parent ? 1 : 0)}</span></div>
          {note.parent && <button className="linked-note-row" onClick={() => onOpenNote(note.parent!)}><ArrowDownLeft size={14} /><span><small>PARENT NOTE</small><strong>{notes.find((item) => item.id === note.parent)?.title}</strong></span><ArrowRight size={14} /></button>}
          {note.children?.map((childId) => {
            const child = notes.find((item) => item.id === childId);
            return child ? <button className="linked-note-row" key={childId} onClick={() => onOpenNote(childId)}><Link2 size={14} /><span><small>SUB-NOTE</small><strong>{child.title}</strong></span><ArrowRight size={14} /></button> : null;
          })}
          {!note.parent && !note.children?.length && <p className="no-links">No connections yet. The best ones appear as you write.</p>}
        </div>
      </div>
      <div className="note-footer-meta"><span>{readMinutes} MIN READ</span><span>SAMPLE PREVIEW <span>·</span> LOCAL EDITS</span></div>
    </article>
  );
}

function NoteBodyPreview({ body }: { body: string }) {
  return (
    <div className="note-body">
      {body.split(/\n\s*\n/).filter(Boolean).map((block, index) => {
        const lines = block.split("\n");
        if (block.startsWith("### ")) return <h3 key={index}>{block.slice(4)}</h3>;
        if (block.startsWith("## ")) return <h2 key={index}>{block.slice(3)}</h2>;
        if (block.startsWith("const ")) return <pre key={index}><code>{block}</code></pre>;
        if (lines.every((line) => line.startsWith("•") || line.startsWith("- "))) {
          return <ul key={index}>{lines.map((line) => <li key={line}>{line.replace(/^(?:•\s*|-\s*)/, "")}</li>)}</ul>;
        }
        return <p key={index}>{block}</p>;
      })}
    </div>
  );
}

function RecordingScreen() {
  return (
    <div className="recording-page page-in">
      <ScreenHeader eyebrow="VOICE NOTES  /  OCTOBER 29" title="Product principles, over coffee" description="A conversation about making room for the work that matters." trailing={<span className="recording-status"><span /> TRANSCRIBED</span>} />
      <section className="recording-player">
        <div className="player-cover"><AudioLines size={22} /><span>34:08</span></div>
        <div className="player-track"><div className="player-track-heading"><strong>Product principles, over coffee</strong><span>34:08</span></div><div className="waveform" aria-hidden="true">{Array.from({ length: 68 }, (_, index) => <i key={index} style={{ height: `${18 + ((index * 37 + 13) % 66)}%` }} />)}</div><div className="player-controls"><button className="player-play" aria-label="Play recording">▶</button><span>00:00</span><div className="player-progress"><span /></div><span>34:08</span><button className="playback-speed">1×</button></div></div>
      </section>
      <div className="speakers-section">
        <div className="section-title-row"><div><h2>People in this conversation</h2><p>Names can be updated any time.</p></div><button className="subtle-button"><Plus size={14} /> Add speaker</button></div>
        <div className="speaker-chips">{recording.speakers.map((speaker) => <button className={`speaker-chip speaker-${speaker.color}`} key={speaker.id}><span className="speaker-avatar">{speaker.initials}</span><span>{speaker.name}</span>{speaker.confirmed && <span className="confirmed-check"><Check size={11} /></span>}{!speaker.confirmed && <span className="speaker-edit">Rename</span>}</button>)}</div>
      </div>
      <section className="transcript-section">
        <div className="section-title-row transcript-title"><div><h2>Transcript</h2><p>6 moments · 3 voices</p></div><button className="transcript-filter"><MoreHorizontal size={16} /></button></div>
        <div className="transcript-list">
          {recording.segments.map((segment) => {
            const speaker = recording.speakers.find((item) => item.id === segment.speakerId)!;
            return <article className={`transcript-segment segment-${speaker.color}`} key={segment.time}><span className="transcript-time">{segment.time}</span><span className="transcript-speaker">{speaker.name}</span><p>{segment.text}</p></article>;
          })}
        </div>
      </section>
      <div className="recording-note-link"><BookOpen size={15} /><span>Linked to</span><button>Studio / Product principles</button><ArrowRight size={14} /></div>
    </div>
  );
}

function ChatMessages({ turns, onCitation, onClarify }: { turns: ChatTurn[]; onCitation: (id: string) => void; onClarify: (option: string) => void }) {
  return (
    <div className="chat-messages">
      {turns.map((turn, index) => {
        if (turn.kind === "question") return <div className="chat-question" key={index}><span className="chat-user-avatar">S</span><p>{turn.text}</p></div>;
        if (turn.kind === "clarify") return <div className="chat-clarify" key={index}><div className="clarify-icon"><HelpCircle size={15} /></div><div><span className="message-label">A QUICK CLARIFICATION</span><p>{turn.text}</p><div className="clarify-options">{turn.options.map((option) => <button key={option} onClick={() => onClarify(option)}>{option}<ArrowRight size={12} /></button>)}</div></div></div>;
        return <div className="chat-answer" key={index}><div className="answer-avatar"><Sparkles size={14} /></div><div><span className="message-label">FROM YOUR NOTES</span><p>{turn.text}</p><div className="citation-row">{turn.citations.map((id, citationIndex) => {
          const note = notes.find((item) => item.id === id);
          return <button key={id} onClick={() => onCitation(id)}><span>[{citationIndex + 1}]</span>{note?.title ?? id}</button>;
        })}</div></div></div>;
      })}
    </div>
  );
}

function ChatComposer({ onSend }: { onSend: (text: string) => void }) {
  const [value, setValue] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = value.trim();
    if (!message) return;
    onSend(message);
    setValue("");
  };
  return <form className="chat-composer" onSubmit={submit}><textarea value={value} onChange={(event) => setValue(event.target.value)} placeholder="Ask anything about your notes…" rows={2} /><div className="composer-bottom"><span><Sparkles size={12} /> Grounded in your library</span><button type="submit" disabled={!value.trim()} aria-label="Send question"><ArrowRight size={15} /></button></div></form>;
}

function ChatScreen({ onOpenNote }: { onOpenNote: (id: string) => void }) {
  const [turns, setTurns] = useState<ChatTurn[]>(conversation);
  const onSend = (text: string) => setTurns((current) => [...current, { kind: "question", text }, { kind: "clarify", text: "Would you like me to look at a specific note, or compare the ideas across your library?", options: ["A specific note", "Across my library"] }]);
  const onClarify = (option: string) => setTurns((current) => [...current, { kind: "question", text: option }, { kind: "answer", text: "Your notes point to a simple next step: preserve focus, keep structure gentle, and make the connections easy to follow.", citations: ["quiet-systems", "editor-principles"] }]);
  return (
    <div className="chat-page page-in">
      <div className="chat-page-heading"><div className="chat-heading-icon"><Sparkles size={17} /></div><div><div className="screen-eyebrow">YOUR NOTES, IN CONVERSATION</div><h1>Ask your notes</h1><p>A thoughtful answer, grounded in what you have kept.</p></div><button className="chat-new-button"><Plus size={14} /> New chat</button></div>
      <div className="chat-context-banner"><span className="context-orb"><Sparkles size={13} /></span><span>Searching across <strong>15 notes</strong></span><span className="context-separator">·</span><span>Only your library</span><button>Change scope <ChevronDown size={12} /></button></div>
      <ChatMessages turns={turns} onCitation={onOpenNote} onClarify={onClarify} />
      <ChatComposer onSend={onSend} />
      <div className="chat-disclaimer">Answers are based on your notes. Check the citations to see the source.</div>
    </div>
  );
}

function ChatAside({ onOpenChat, onOpenNote }: { onOpenChat: () => void; onOpenNote: (id: string) => void }) {
  const [turns, setTurns] = useState<ChatTurn[]>(conversation);
  const onSend = (text: string) => setTurns((current) => [...current, { kind: "question", text }, { kind: "clarify", text: "Which note would you like to explore?", options: ["Editor principles", "Across my library"] }]);
  return (
    <aside className="chat-aside">
      <div className="chat-aside-header"><div><span className="aside-sparkle"><Sparkles size={13} /></span><strong>Ask your notes</strong></div><button className="quiet-icon-button" aria-label="Collapse chat"><PanelRightClose size={15} /></button></div>
      <div className="chat-aside-context"><span className="online-dot" /> Grounded in your library</div>
      <ChatMessages turns={turns} onCitation={onOpenNote} onClarify={(option) => setTurns((current) => [...current, { kind: "question", text: option }, { kind: "answer", text: "Your notes keep returning to focus, gentle structure, and meaningful connections.", citations: ["quiet-systems", "editor-principles"] }])} />
      <ChatComposer onSend={onSend} />
      <button className="open-full-chat" onClick={onOpenChat}>Open full chat <ArrowRight size={13} /></button>
    </aside>
  );
}

function SettingsScreen({
  theme,
  setTheme,
  direction,
  motionPreference,
  setMotionPreference,
  readerTextSize,
  setReaderTextSize,
  readerWidth,
  setReaderWidth,
  onOpenUrdu,
  onOpenDirections,
}: {
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
  direction: Direction;
  motionPreference: MotionPreference;
  setMotionPreference: (preference: MotionPreference) => void;
  readerTextSize: ReaderTextSize;
  setReaderTextSize: (size: ReaderTextSize) => void;
  readerWidth: ReaderWidth;
  setReaderWidth: (width: ReaderWidth) => void;
  onOpenUrdu: () => void;
  onOpenDirections: () => void;
}) {
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const choices: { id: ThemeChoice; title: string; detail: string; icon: string }[] = [
    { id: "light", title: "Light", detail: "A clear page, any time of day.", icon: "☼" },
    { id: "dark", title: "Dark", detail: direction === "c" ? "Deep charcoal, with every idea lit." : "Easy on the eyes after hours.", icon: "☾" },
    { id: "system", title: "System", detail: "Follow your device's appearance.", icon: "◐" },
  ];
  return (
    <div className="settings-page page-in">
      <ScreenHeader eyebrow="MAKE IT YOURS" title="Appearance" description="A small space should feel right in every light." />
      <section className="settings-section">
        <div className="settings-section-title"><div><h2>Theme</h2><p>Choose the atmosphere for your workspace.</p></div><span className="settings-current"><span className="online-dot" /> {theme === "system" ? "Following system" : `${theme[0].toUpperCase()}${theme.slice(1)} mode`}</span></div>
        <div className="theme-options">
          {choices.map((choice) => <button className={`theme-option ${theme === choice.id ? "theme-option-selected" : ""}`} key={choice.id} onClick={() => setTheme(choice.id)}><span className={`theme-preview theme-preview-${choice.id}`}><span /><span /><span /></span><span className="theme-option-copy"><strong>{choice.title}</strong><small>{choice.detail}</small></span><span className="theme-radio">{theme === choice.id && <span />}</span></button>)}
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section-title"><div><h2>Language & writing</h2><p>One place for more than one way to write.</p></div></div>
        <button className="setting-row" onClick={onOpenUrdu}><span className="setting-language">ع</span><span><strong>Urdu sample</strong><small>Right-to-left note layout · Noto Nastaliq Urdu</small></span><span className="setting-row-value">View sample <ArrowRight size={13} /></span></button>
      </section>
      <section className="settings-section">
        <div className="settings-section-title"><div><h2>Reading preferences</h2><p>Make long notes easier to settle into. These choices apply to the note viewer.</p></div></div>
        <div className="reader-setting-grid">
          <div className="reader-setting">
            <strong>Text size</strong>
            <div className="setting-segmented" role="group" aria-label="Note text size">
              {(["small", "comfortable", "large"] as const).map((size) => (
                <button key={size} type="button" aria-pressed={readerTextSize === size} onClick={() => setReaderTextSize(size)}>
                  {size === "small" ? "Small" : size === "comfortable" ? "Comfortable" : "Large"}
                </button>
              ))}
            </div>
          </div>
          <div className="reader-setting">
            <strong>Reading width</strong>
            <div className="setting-segmented" role="group" aria-label="Note reading width">
              {(["narrow", "comfortable", "wide"] as const).map((width) => (
                <button key={width} type="button" aria-pressed={readerWidth === width} onClick={() => setReaderWidth(width)}>
                  {width === "narrow" ? "Narrow" : width === "comfortable" ? "Comfortable" : "Wide"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
      <section className="settings-section system-preview-section">
        <div className="settings-section-title"><div><h2>Workspace & privacy</h2><p>Choose how this space feels and see how preview data is handled.</p></div></div>
        <div className="direction-details">
          <button className="direction-detail-card" type="button" onClick={onOpenDirections}>
            <span>01</span><strong>Workspace style</strong><small>{directionMeta[direction].name} · {directionMeta[direction].tagline}</small><span className="direction-detail-action">Change style <ArrowRight size={12} /></span>
          </button>
          <div className="direction-detail-card direction-motion-card">
            <span>02</span><strong>Reduced motion</strong><small>{motionPreference === "reduced" ? "Extra motion is minimized." : "Follow your device setting."}</small>
            <button
              className="settings-switch"
              type="button"
              role="switch"
              aria-label="Reduce motion"
              aria-checked={motionPreference === "reduced"}
              onClick={() => setMotionPreference(motionPreference === "reduced" ? "system" : "reduced")}
            ><span />{motionPreference === "reduced" ? "On" : "System"}</button>
          </div>
          <button className="direction-detail-card" type="button" aria-expanded={privacyOpen} aria-controls="preview-privacy-details" onClick={() => setPrivacyOpen((open) => !open)}>
            <span>03</span><strong>Private by default</strong><small>Sample notes only · no account sync</small><span className="direction-detail-action">{privacyOpen ? "Hide details" : "Privacy details"} <ShieldCheck size={12} /></span>
          </button>
        </div>
        {privacyOpen && (
          <div className="privacy-details" id="preview-privacy-details" role="region" aria-label="Preview privacy details">
            <ShieldCheck size={16} />
            <p>This design preview uses sample notes in your browser and does not connect to account sync. Theme, reading preferences, and saved-note stars are stored in this browser.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function UrduScreen({ onOpenNote, onBack }: { onOpenNote: (id: string) => void; onBack: () => void }) {
  return (
    <article className="urdu-page page-in">
      <div className="note-breadcrumb"><button onClick={onBack}><ArrowLeft size={13} /> Library</button><ChevronRight size={13} /><span>Language preview</span><ChevronRight size={13} /><span className="breadcrumb-current">Urdu · RTL</span></div>
      <div className="urdu-sample-heading"><span className="rtl-badge">RTL PREVIEW</span><span>CONTENT FLOWS RIGHT TO LEFT · APP NAVIGATION STAYS LTR</span></div>
      <div className="urdu-article" lang="ur" dir="rtl">
        <div className="urdu-meta">ذاتی نوٹس <span>·</span> آج</div>
        <h1>{urduSample.title}</h1>
        <p className="urdu-deck">خیالات، یادیں اور وہ چھوٹی باتیں جنہیں ہم سنبھال کر رکھنا چاہتے ہیں۔</p>
        <div className="urdu-body">{urduSample.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
        <div className="urdu-inline-card"><span>ایک خیال</span><p>لکھنا شروع کرنے کے لیے ہر چیز کو ترتیب دینا ضروری نہیں۔</p></div>
        <div className="urdu-linked"><span>متعلقہ نوٹ</span><button onClick={() => onOpenNote("quiet-systems")}>Designing quiet systems <ArrowLeft size={13} /></button></div>
      </div>
      <div className="urdu-note"><Check size={14} /><span>Only the note content and its relevant controls switch to RTL. The folder tree and app navigation remain LTR.</span></div>
    </article>
  );
}

function PaletteResults({ query, onOpenNote, onOpenScreen }: { query: string; onOpenNote: (id: string) => void; onOpenScreen: (screen: Screen) => void }) {
  const matches = notes.filter((note) => note.title.toLowerCase().includes(query.toLowerCase()) || note.excerpt.toLowerCase().includes(query.toLowerCase())).slice(0, 5);
  const actions: { label: string; detail: string; screen: Screen; icon: typeof Home }[] = [
    { label: "Open library", detail: "Browse all your notes", screen: "library", icon: Library },
    { label: "Start a recording", detail: "View the recording console", screen: "recording", icon: Mic2 },
    { label: "Ask your notes", detail: "Open your AI conversation", screen: "chat", icon: Sparkles },
    { label: "Appearance settings", detail: "Change theme and language", screen: "settings", icon: Settings2 },
  ];
  const visibleActions = actions.filter((action) => `${action.label} ${action.detail}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="palette-results">
      {matches.length > 0 && <><div className="palette-group-label">NOTES</div>{matches.map((note, index) => <button className="palette-result" key={note.id} onClick={() => onOpenNote(note.id)}><span className={`palette-note-icon palette-icon-${index}`}><FileText size={14} /></span><span><strong>{note.title}</strong><small>{note.folder} <span>·</span> {note.updated}</small></span><kbd>↵</kbd></button>)}</>}
      {visibleActions.length > 0 && <><div className="palette-group-label">{matches.length > 0 ? "QUICK ACTIONS" : "JUMP TO"}</div>{visibleActions.map(({ label, detail, screen, icon: Icon }) => <button className="palette-result" key={screen} onClick={() => onOpenScreen(screen)}><span className="palette-action-icon"><Icon size={14} /></span><span><strong>{label}</strong><small>{detail}</small></span><ArrowRight size={14} /></button>)}</>}
      {!matches.length && !visibleActions.length && <div className="palette-empty"><Search size={17} /><span>No notes or actions found for “{query}”</span></div>}
    </div>
  );
}
