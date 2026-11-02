import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";
import { Markdown } from "@tiptap/markdown";
import { useTranslation } from "react-i18next";
import type { Note } from "../api/notes";
import "katex/dist/katex.min.css";

type EditorMenu = {
  kind: "slash" | "wiki";
  from: number;
  to: number;
  query: string;
} | null;

export function NoteBodyEditor({ value, notes, placeholder, onChange, onKindChange }: {
  value: string;
  notes: Note[];
  placeholder: string;
  onChange: (value: string) => void;
  onKindChange: (kind: string) => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<EditorMenu>(null);
  const notesRef = useRef(notes);
  const onChangeRef = useRef(onChange);
  notesRef.current = notes;
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown,
      Placeholder.configure({ placeholder }),
      InlineMath.configure({ katexOptions: { throwOnError: false } }),
      BlockMath.configure({ katexOptions: { throwOnError: false } }),
    ],
    content: value,
    contentType: "markdown",
    editorProps: {
      attributes: { class: "workspace-note-body-content", dir: "auto" },
      handleClick: (view, position, event) => {
        if (!(event.metaKey || event.ctrlKey)) return false;
        const resolved = view.state.doc.resolve(position);
        const text = resolved.parent.textContent;
        const offset = resolved.parentOffset;
        const start = text.lastIndexOf("[[", Math.max(0, offset - 1));
        const end = text.indexOf("]]", offset);
        if (start < 0 || end < 0) return false;
        const title = text.slice(start + 2, end).trim().toLocaleLowerCase();
        const target = notesRef.current.find((note) => note.title.trim().toLocaleLowerCase() === title);
        if (!target) return false;
        window.dispatchEvent(new CustomEvent("notez:open-note", { detail: { noteId: target.id } }));
        return true;
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      const { $from } = currentEditor.state.selection;
      const textBefore = $from.parent.textBetween(0, $from.parentOffset);
      const wikiMatch = textBefore.match(/\[\[([^\]]*)$/);
      if (wikiMatch) {
        setMenu({ kind: "wiki", from: $from.pos - wikiMatch[0].length, to: $from.pos, query: wikiMatch[1] });
      } else {
        const slashMatch = textBefore.match(/(?:^|\s)\/([a-z0-9]*)$/i);
        if (slashMatch) {
          setMenu({ kind: "slash", from: $from.pos - slashMatch[0].length, to: $from.pos, query: slashMatch[1] });
        } else {
          setMenu(null);
        }
      }
      onChangeRef.current(currentEditor.getMarkdown());
    },
  }, []);

  useEffect(() => {
    if (editor && editor.getMarkdown() !== value) {
      editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
    }
  }, [editor, value]);

  const linkMatches = useMemo(() => {
    if (!menu || menu.kind !== "wiki") return [];
    const query = menu.query.toLocaleLowerCase();
    return notes.filter((note) => note.title.toLocaleLowerCase().includes(query)).slice(0, 5);
  }, [menu, notes]);

  if (!editor) return <div className="workspace-note-body workspace-editor-loading" aria-busy="true" />;

  const selectWikiLink = (note: Note) => {
    if (!menu) return;
    editor.chain().focus().deleteRange({ from: menu.from, to: menu.to }).insertContent(`[[${note.title}]]`).run();
    setMenu(null);
  };
  const runSlashCommand = (command: "heading" | "list" | "code" | "math" | "link" | "kind:note" | "kind:idea" | "kind:meeting" | "kind:reference") => {
    if (!menu) return;
    const range = { from: menu.from, to: menu.to };
    if (command.startsWith("kind:")) {
      editor.chain().focus().deleteRange(range).run();
      onKindChange(command.slice("kind:".length));
      setMenu(null);
      return;
    }
    if (command === "link") {
      editor.chain().focus().deleteRange(range).insertContent("[[").run();
      setMenu({ kind: "wiki", from: range.from, to: range.from + 2, query: "" });
      return;
    }
    const chain = editor.chain().focus().deleteRange(range);
    if (command === "heading") chain.toggleHeading({ level: 2 }).run();
    else if (command === "list") chain.toggleBulletList().run();
    else if (command === "code") chain.toggleCodeBlock().run();
    else chain.insertInlineMath({ latex: "x^2" }).run();
    setMenu(null);
  };

  return (
    <div className="workspace-rich-editor">
      <div className="workspace-editor-formatting" aria-label={t("editor.formatting")}>
        <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} aria-label={t("editor.bold")} aria-pressed={editor.isActive("bold")}><strong>B</strong></button>
        <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} aria-label={t("editor.italic")} aria-pressed={editor.isActive("italic")}><em>I</em></button>
        <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} aria-label={t("editor.heading")}>H₂</button>
        <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} aria-label={t("editor.bulletedList")}>• —</button>
        <button type="button" onClick={() => editor.chain().focus().toggleCodeBlock().run()} aria-label={t("editor.codeBlock")}>&lt;/&gt;</button>
        <span>{t("editor.commandsHint")} <kbd>/</kbd> · <kbd>[[</kbd> {t("editor.referenceHint")}</span>
      </div>
      <EditorContent editor={editor} className="workspace-note-body" />
      {menu?.kind === "slash" && (
        <div className="workspace-editor-suggestions" role="listbox" aria-label={t("editor.commands")}>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runSlashCommand("heading")}>{t("editor.heading")}</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runSlashCommand("list")}>{t("editor.bulletedList")}</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runSlashCommand("code")}>{t("editor.codeBlock")}</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runSlashCommand("math")}>{t("editor.inlineMath")}</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runSlashCommand("link")}>{t("editor.insertNoteLink")}</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runSlashCommand("kind:note")}>{t("editor.kindNote")}</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runSlashCommand("kind:idea")}>{t("editor.kindIdea")}</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runSlashCommand("kind:meeting")}>{t("editor.kindMeeting")}</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runSlashCommand("kind:reference")}>{t("editor.kindReference")}</button>
        </div>
      )}
      {menu?.kind === "wiki" && linkMatches.length > 0 && (
        <div className="workspace-editor-suggestions" role="listbox" aria-label={t("editor.references")}>
          {linkMatches.map((note) => (
            <button type="button" key={note.id} onMouseDown={(event) => event.preventDefault()} onClick={() => selectWikiLink(note)}>
              {note.title || t("editor.titlePlaceholder")}<small>{note.folder_path || t("common.myNotes")}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
