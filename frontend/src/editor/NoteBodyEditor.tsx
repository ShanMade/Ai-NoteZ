import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { Bold, Code, Heading2, Italic, Link as LinkIcon, List, ListOrdered, Quote, Sigma } from "lucide-react";
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

  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive("bold") ?? false,
      italic: current?.isActive("italic") ?? false,
      heading: current?.isActive("heading", { level: 2 }) ?? false,
      quote: current?.isActive("blockquote") ?? false,
      bullet: current?.isActive("bulletList") ?? false,
      ordered: current?.isActive("orderedList") ?? false,
      code: current?.isActive("codeBlock") ?? false,
    }),
  });

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
      <div className="workspace-editor-formatting" role="toolbar" aria-label={t("editor.formatting")}>
        <div className="workspace-format-group">
          <button type="button" className="workspace-format-btn" onClick={() => editor.chain().focus().toggleBold().run()} aria-label={t("editor.bold")} title={t("editor.bold")} aria-pressed={active?.bold ?? false}><Bold size={15} /></button>
          <button type="button" className="workspace-format-btn" onClick={() => editor.chain().focus().toggleItalic().run()} aria-label={t("editor.italic")} title={t("editor.italic")} aria-pressed={active?.italic ?? false}><Italic size={15} /></button>
        </div>
        <span className="workspace-format-divider" aria-hidden="true" />
        <div className="workspace-format-group">
          <button type="button" className="workspace-format-btn" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} aria-label={t("editor.heading")} title={t("editor.heading")} aria-pressed={active?.heading ?? false}><Heading2 size={15} /></button>
          <button type="button" className="workspace-format-btn" onClick={() => editor.chain().focus().toggleBlockquote().run()} aria-label={t("editor.quote", { defaultValue: "Quote" })} title={t("editor.quote", { defaultValue: "Quote" })} aria-pressed={active?.quote ?? false}><Quote size={15} /></button>
          <button type="button" className="workspace-format-btn" onClick={() => editor.chain().focus().toggleBulletList().run()} aria-label={t("editor.bulletedList")} title={t("editor.bulletedList")} aria-pressed={active?.bullet ?? false}><List size={15} /></button>
          <button type="button" className="workspace-format-btn" onClick={() => editor.chain().focus().toggleOrderedList().run()} aria-label={t("editor.numberedList", { defaultValue: "Numbered list" })} title={t("editor.numberedList", { defaultValue: "Numbered list" })} aria-pressed={active?.ordered ?? false}><ListOrdered size={15} /></button>
          <button type="button" className="workspace-format-btn" onClick={() => editor.chain().focus().toggleCodeBlock().run()} aria-label={t("editor.codeBlock")} title={t("editor.codeBlock")} aria-pressed={active?.code ?? false}><Code size={15} /></button>
        </div>
        <span className="workspace-format-divider" aria-hidden="true" />
        <div className="workspace-format-group">
          <button type="button" className="workspace-format-btn" onClick={() => editor.chain().focus().insertInlineMath({ latex: "x^2" }).run()} aria-label={t("editor.inlineMath")} title={t("editor.inlineMath")}><Sigma size={15} /></button>
          <button type="button" className="workspace-format-btn" onClick={() => editor.chain().focus().insertContent("[[").run()} aria-label={t("editor.insertNoteLink")} title={t("editor.insertNoteLink")}><LinkIcon size={15} /></button>
        </div>
        <span className="workspace-format-hint">{t("editor.commandsHint")} <kbd>/</kbd> · <kbd>[[</kbd> {t("editor.referenceHint")}</span>
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
