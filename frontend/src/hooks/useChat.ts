import { useCallback, useEffect, useRef, useState } from "react";
import { getAccessToken, type AccessTokenProvider } from "../recorder/api";

export interface ChatCitation {
  note_id: string;
  title: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: ChatCitation[];
  isClarification: boolean;
  isStreaming: boolean;
  messageIndex?: number;
  savedNoteId?: string;
}

interface ChatHistoryResponse {
  conversation_id: string;
  messages: Array<{
    message_index: number;
    role: "user" | "assistant";
    content: string;
    citations: ChatCitation[];
    is_clarification: boolean;
  }>;
}

interface NoteListResponse {
  items: Array<{ title: string }>;
}

interface ChatOptions {
  noteId?: string;
  conversationId?: string;
  getAccessToken?: AccessTokenProvider;
  onCreateNote?: (content: string) => void;
}

const API_BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";
const FALLBACK_EXAMPLES = [
  "What themes keep coming up in my notes?",
  "What should I revisit next?",
  "Summarize my latest ideas.",
];

function messageFromHistory(
  message: ChatHistoryResponse["messages"][number],
): ChatMessage {
  return {
    id: `history-${message.message_index}`,
    role: message.role,
    content: message.content,
    citations: message.citations,
    isClarification: message.is_clarification,
    isStreaming: false,
    messageIndex: message.message_index,
  };
}

export function useChat({
  noteId,
  conversationId: initialConversationId,
  getAccessToken: tokenProvider,
  onCreateNote,
}: ChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(initialConversationId);
  const [examples, setExamples] = useState(FALLBACK_EXAMPLES);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController>();
  const activeAssistantRef = useRef<string>();
  const requestIdRef = useRef(0);
  const isSendingRef = useRef(false);

  const updateMessage = useCallback((id: string, update: (message: ChatMessage) => ChatMessage) => {
    setMessages((current) => current.map((message) => message.id === id ? update(message) : message));
  }, []);

  useEffect(() => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = undefined;
    activeAssistantRef.current = undefined;
    isSendingRef.current = false;
    setIsSending(false);
    setConversationId(initialConversationId);
    setMessages([]);
    setError("");
  }, [initialConversationId, noteId]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const token = await getAccessToken(tokenProvider);
        const response = await fetch(
          initialConversationId
            ? `${API_BASE}/v1/ai/chat/${initialConversationId}/history`
            : `${API_BASE}/v1/notes?limit=4`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!response.ok) {
          const failure = await response.json().catch(() => null) as { detail?: string } | null;
          throw new Error(failure?.detail ?? `Could not load chat context (${response.status}).`);
        }
        if (initialConversationId) {
          const history = await response.json() as ChatHistoryResponse;
          if (active) setMessages(history.messages.map(messageFromHistory));
        } else {
          const notes = await response.json() as NoteListResponse;
          if (!active || !notes.items.length) return;
          setExamples(notes.items.slice(0, 3).map((note) => `What did I write about ${note.title}?`));
        }
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Could not load chat context.");
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [initialConversationId, tokenProvider]);

  const send = useCallback(async (rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (!question || isSendingRef.current) return;
    const requestId = ++requestIdRef.current;
    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    const controller = new AbortController();
    abortRef.current = controller;
    activeAssistantRef.current = assistantId;
    isSendingRef.current = true;
    setIsSending(true);
    setError("");
    setMessages((current) => [
      ...current,
      {
        id: userId,
        role: "user",
        content: question,
        citations: [],
        isClarification: false,
        isStreaming: false,
      },
      {
        id: assistantId,
        role: "assistant",
        content: "",
        citations: [],
        isClarification: false,
        isStreaming: true,
      },
    ]);

    try {
      const token = await getAccessToken(tokenProvider);
      const response = await fetch(`${API_BASE}/v1/ai/chat`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          question,
          ...(noteId ? { note_id: noteId } : {}),
          ...(conversationId ? { conversation_id: conversationId } : {}),
        }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => null) as { detail?: string } | null;
        throw new Error(failure?.detail ?? `Chat request failed (${response.status}).`);
      }
      if (!response.body) throw new Error("The browser could not read the chat response stream.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "message";
      const handleFrame = (frame: string) => {
        if (requestIdRef.current !== requestId) return;
        let data = "";
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) return;
        const payload = JSON.parse(data) as Record<string, unknown>;
        if (currentEvent === "meta" && typeof payload.conversation_id === "string") {
          setConversationId(payload.conversation_id);
        } else if (currentEvent === "sources" && Array.isArray(payload.citations)) {
          updateMessage(assistantId, (message) => ({ ...message, citations: payload.citations as ChatCitation[] }));
        } else if (currentEvent === "token" && typeof payload.text === "string") {
          updateMessage(assistantId, (message) => ({ ...message, content: message.content + payload.text as string }));
        } else if (currentEvent === "clarification" && typeof payload.text === "string") {
          updateMessage(assistantId, (message) => ({
            ...message,
            content: payload.text as string,
            isClarification: true,
          }));
        } else if (currentEvent === "done") {
          updateMessage(assistantId, (message) => ({
            ...message,
            isStreaming: false,
            isClarification: Boolean(payload.is_clarification),
            messageIndex: typeof payload.message_index === "number" ? payload.message_index : undefined,
            citations: Array.isArray(payload.citations) ? payload.citations as ChatCitation[] : message.citations,
          }));
        } else if (currentEvent === "error") {
          throw new Error(typeof payload.message === "string" ? payload.message : "The answer stream failed.");
        }
        currentEvent = "message";
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? "";
        frames.forEach(handleFrame);
        if (done) break;
      }
      if (buffer.trim()) handleFrame(buffer);
      updateMessage(assistantId, (message) => ({ ...message, isStreaming: false }));
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        if (requestIdRef.current === requestId) {
          updateMessage(assistantId, (message) => ({ ...message, isStreaming: false }));
        }
        return;
      }
      if (requestIdRef.current !== requestId) return;
      const message = caught instanceof Error ? caught.message : "The answer could not be completed.";
      setError(message);
      updateMessage(assistantId, (item) => ({
        ...item,
        isStreaming: false,
        content: item.content || "I couldn't finish that response. Please try again.",
      }));
    } finally {
      if (requestIdRef.current === requestId) {
        isSendingRef.current = false;
        abortRef.current = undefined;
        activeAssistantRef.current = undefined;
        setIsSending(false);
      }
    }
  }, [conversationId, noteId, tokenProvider, updateMessage]);

  const saveAsNote = useCallback(async (message: ChatMessage) => {
    if (!conversationId || message.messageIndex === undefined || message.isClarification) return;
    setError("");
    try {
      const token = await getAccessToken(tokenProvider);
      const response = await fetch(`${API_BASE}/v1/ai/note-from-answer`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: conversationId,
          message_index: message.messageIndex,
        }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => null) as { detail?: string } | null;
        throw new Error(failure?.detail ?? `Could not save this answer (${response.status}).`);
      }
      const note = await response.json() as { id: string; body: string };
      updateMessage(message.id, (current) => ({ ...current, savedNoteId: note.id }));
      onCreateNote?.(note.body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this answer as a note.");
    }
  }, [conversationId, onCreateNote, tokenProvider, updateMessage]);

  const startNewChat = useCallback(() => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = undefined;
    activeAssistantRef.current = undefined;
    isSendingRef.current = false;
    setIsSending(false);
    setMessages([]);
    setConversationId(undefined);
    setError("");
  }, []);

  const stop = useCallback(() => {
    if (!isSendingRef.current) return;
    requestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = undefined;
    isSendingRef.current = false;
    setIsSending(false);
    if (activeAssistantRef.current) {
      updateMessage(activeAssistantRef.current, (message) => ({ ...message, isStreaming: false }));
    }
    activeAssistantRef.current = undefined;
  }, [updateMessage]);

  useEffect(() => () => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
  }, []);

  return {
    messages,
    conversationId,
    examples,
    isSending,
    error,
    send,
    stop,
    saveAsNote,
    startNewChat,
  };
}
