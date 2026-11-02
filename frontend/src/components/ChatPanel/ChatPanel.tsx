import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { ArrowUp, BookOpen, Check, CircleHelp, FilePlus2, Plus, Sparkles, Square, X } from "lucide-react";
import { useChat } from "../../hooks/useChat";
import type { AccessTokenProvider } from "../../recorder/api";
import "./ChatPanel.css";

export interface ChatPanelProps {
  noteId?: string;
  conversationId?: string;
  onClose?: () => void;
  onOpenNote?: (noteId: string) => void;
  onCreateNote?: (content: string) => void;
  getAccessToken?: AccessTokenProvider;
}

export function ChatPanel({
  noteId,
  conversationId,
  onClose,
  onOpenNote,
  onCreateNote,
  getAccessToken,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [showLatestButton, setShowLatestButton] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const previousMessageCount = useRef(0);
  const {
    messages,
    examples,
    isSending,
    error,
    send,
    stop,
    saveAsNote,
    startNewChat,
  } = useChat({ noteId, conversationId, getAccessToken, onCreateNote });

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (messages.length === 0) {
      previousMessageCount.current = 0;
      followLatestRef.current = true;
      setShowLatestButton(false);
      list.scrollTop = 0;
      return;
    }
    const latestMessage = messages[messages.length - 1];
    if (latestMessage?.role === "user" && messages.length !== previousMessageCount.current) {
      followLatestRef.current = true;
    }
    previousMessageCount.current = messages.length;
    if (followLatestRef.current) {
      list.scrollTop = list.scrollHeight;
      setShowLatestButton(false);
    } else {
      setShowLatestButton(true);
    }
  }, [messages]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const question = draft.trim();
    if (!question || isSending) return;
    setDraft("");
    void send(question);
  };
  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };
  const openCitation = (noteIdValue: string) => {
    if (onOpenNote) onOpenNote(noteIdValue);
    else window.dispatchEvent(new CustomEvent("notez:open-note", { detail: { noteId: noteIdValue } }));
  };

  return (
    <aside className="notez-chat-panel" aria-label="Ask your notes">
      <header className="notez-chat-header">
        <div className="notez-chat-heading">
          <span className="notez-chat-mark"><Sparkles size={16} /></span>
          <div>
            <p className="notez-chat-eyebrow">YOUR NOTES, IN CONVERSATION</p>
            <h2>Ask your notes</h2>
          </div>
        </div>
        <div className="notez-chat-header-actions">
          <button type="button" className="notez-chat-icon-button" aria-label="Start a new chat" onClick={startNewChat}>
            <Plus size={16} />
          </button>
          {onClose && (
            <button type="button" className="notez-chat-icon-button" aria-label="Close chat" onClick={onClose}>
              <X size={16} />
            </button>
          )}
        </div>
      </header>

      <div className="notez-chat-context">
        <span className="notez-chat-live-dot" />
        <span>{noteId ? "Grounded in this note" : "Grounded in your library"}</span>
        <span className="notez-chat-private"><BookOpen size={12} /> Private to you</span>
      </div>

      <div
        className="notez-chat-messages"
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        onScroll={(event) => {
          const list = event.currentTarget;
          const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
          followLatestRef.current = nearBottom;
          if (nearBottom) setShowLatestButton(false);
        }}
      >
        {messages.length === 0 ? (
          <div className="notez-chat-empty">
            <div className="notez-chat-empty-art" aria-hidden="true">
              <span className="notez-chat-orbit notez-chat-orbit-one" />
              <span className="notez-chat-orbit notez-chat-orbit-two" />
              <span className="notez-chat-empty-center"><Sparkles size={19} /></span>
            </div>
            <p className="notez-chat-eyebrow">A LITTLE CURIOSITY GOES A LONG WAY</p>
            <h3>{noteId ? "Let’s look closer." : "Your notes have a story."}</h3>
            <p className="notez-chat-empty-copy">
              {noteId
                ? "Ask about an idea, detail, or connection in this note."
                : "Ask a question and I’ll look for the clearest thread across your library."}
            </p>
            <div className="notez-chat-suggestions">
              {examples.map((example) => (
                <button key={example} type="button" onClick={() => void send(example)} disabled={isSending}>
                  <span>{example}</span><ArrowUp size={13} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="notez-chat-thread">
            {messages.map((message) => message.role === "user" ? (
              <article className="notez-chat-user-message" key={message.id}>
                <p>{message.content}</p>
              </article>
            ) : (
              <article
                className={`notez-chat-answer ${message.isClarification ? "notez-chat-answer-clarifying" : ""}`}
                key={message.id}
              >
                <span className="notez-chat-answer-icon">
                  {message.isClarification ? <CircleHelp size={15} /> : <Sparkles size={15} />}
                </span>
                <div className="notez-chat-answer-content">
                  <p className="notez-chat-answer-label">
                    {message.isClarification ? "A QUICK CLARIFICATION" : "FROM YOUR NOTES"}
                  </p>
                  {message.content ? (
                    <p className="notez-chat-answer-text">
                      {message.content}
                      {message.isStreaming && <span className="notez-chat-caret" aria-hidden="true" />}
                    </p>
                  ) : message.isStreaming ? (
                    <div className="notez-chat-typing" role="status" aria-label="Thinking">
                      <span /><span /><span /><span /><span />
                      <small>Following the thread…</small>
                    </div>
                  ) : null}
                  {message.citations.length > 0 && (
                    <div className="notez-chat-citations" aria-label="Sources">
                      {message.citations.map((citation, index) => (
                        <button
                          key={`${citation.note_id}-${index}`}
                          type="button"
                          onClick={() => openCitation(citation.note_id)}
                          title={`Open ${citation.title}`}
                        >
                          <span>[{index + 1}]</span>{citation.title}
                        </button>
                      ))}
                    </div>
                  )}
                  {!message.isClarification && message.content && !message.isStreaming && (
                    <div className="notez-chat-answer-actions">
                      <button
                        type="button"
                        onClick={() => void saveAsNote(message)}
                        disabled={message.savedNoteId !== undefined || message.messageIndex === undefined}
                      >
                        {message.savedNoteId ? <Check size={12} /> : <FilePlus2 size={12} />}
                        {message.savedNoteId ? "Saved as note" : "Save as note"}
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        {showLatestButton && (
          <button
            type="button"
            className="notez-chat-latest-button"
            onClick={() => {
              const list = listRef.current;
              if (!list) return;
              followLatestRef.current = true;
              list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
              setShowLatestButton(false);
            }}
          >
            Jump to latest
          </button>
        )}
      </div>

      {error && <p className="notez-chat-error" role="alert">{error}</p>}
      <form className="notez-chat-composer" onSubmit={submit}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onComposerKeyDown}
          placeholder={noteId ? "Ask about this note…" : "Ask anything about your notes…"}
          aria-label="Your question"
          rows={2}
          maxLength={12_000}
        />
        <div className="notez-chat-composer-footer">
          <span><Sparkles size={12} /> Answers include note citations</span>
          {isSending ? (
            <button type="button" onClick={stop} aria-label="Stop generating" title="Stop generating">
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button type="submit" disabled={!draft.trim()} aria-label="Send question">
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </form>
      <p className="notez-chat-disclaimer">Answers are based on your notes. Follow a citation to check the source.</p>
    </aside>
  );
}

export default ChatPanel;
