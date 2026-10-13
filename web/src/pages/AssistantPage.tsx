import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { branding } from "../config/branding";
import { ArrowRightIcon, MicIcon } from "../components/icons";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";

interface ExecutedAction {
  type: string;
  ok: boolean;
  summary: string;
  taskId?: string;
  taskTitle?: string;
  undo?: { kind: "complete" | "drop" | "snooze" | "reopen"; taskId: string };
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: ExecutedAction[] | null;
}

interface Conversation {
  id: string;
  messages: ChatMessage[];
}

const SUGGESTIONS = [
  "What's on today?",
  "Remind me to call Mom every Monday",
  "Cancel the drop party task",
  "I just watered the plants",
  "Snooze that package until Thursday",
];

export function AssistantPage() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const speech = useSpeechRecognition((text) => {
    setDraft(text);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
      }
    });
  });

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
    });
  }, []);

  useEffect(() => {
    api
      .get<Conversation>("/assistant/conversation")
      .then((c) => {
        setConversationId(c.id);
        setMessages(
          c.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            actions: (m.actions as ExecutedAction[] | null) ?? null,
          }))
        );
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    speech.stop();
    setSending(true);
    setError(null);
    setDraft("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    // Optimistic user bubble.
    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [...prev, { id: tempId, role: "user", content: trimmed }]);

    try {
      const res = await api.post<{
        conversationId: string;
        message: ChatMessage;
        executed: ExecutedAction[];
      }>("/assistant/message", { text: trimmed, conversationId: conversationId ?? undefined });
      setConversationId(res.conversationId);
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempId),
        { id: `user-${res.message.id}`, role: "user", content: trimmed },
        {
          id: res.message.id,
          role: "assistant",
          content: res.message.content,
          actions: res.executed,
        },
      ]);
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setError(e instanceof Error ? e.message : "Something went wrong");
      setDraft(trimmed);
    } finally {
      setSending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(draft);
    }
  }

  async function onUndo(undo: NonNullable<ExecutedAction["undo"]>) {
    try {
      await api.post("/assistant/undo", undo);
      setMessages((prev) => [
        ...prev,
        {
          id: `undo-${Date.now()}`,
          role: "assistant",
          content: "Undone.",
          actions: null,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Undo failed");
    }
  }

  async function onNewChat() {
    try {
      const c = await api.post<Conversation>("/assistant/conversation/new", {});
      setConversationId(c.id);
      setMessages([]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start a new chat");
    }
  }

  if (loading) return <p className="muted">Loading...</p>;

  return (
    <div className="page assistant-page">
      <header className="assistant-header">
        <div>
          <h1>{branding.assistantName}</h1>
          <p className="orientation">Talk or type. I can add, finish, cancel, snooze, and catch you up.</p>
        </div>
        <button type="button" className="assistant-new" onClick={onNewChat} title="New conversation">
          New chat
        </button>
      </header>

      <div className="assistant-thread" ref={scrollerRef}>
        {messages.length === 0 && (
          <div className="assistant-empty">
            <p className="assistant-empty-lead">What's on your mind?</p>
            <div className="assistant-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="assistant-suggestion" onClick={() => send(s)} disabled={sending}>
                  {s}
                </button>
              ))}
            </div>
            <p className="muted small">
              Prefer a fast dump without chatting? Use <Link to="/today">Quick add on Today</Link>.
            </p>
          </div>
        )}

        {messages.map((m) => {
          const undoable = m.actions?.filter((a) => a.ok && a.undo) ?? [];
          return (
            <div key={m.id} className={`assistant-bubble ${m.role}`}>
              <div className="assistant-bubble-body">{m.content}</div>
              {undoable.length > 0 && (
                <div className="assistant-undo-row">
                  {undoable.map((a) => (
                    <button
                      key={`${a.undo!.kind}-${a.undo!.taskId}`}
                      type="button"
                      className="assistant-undo"
                      onClick={() => onUndo(a.undo!)}
                    >
                      Undo {a.type === "drop" ? "cancel" : a.type}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {sending && (
          <div className="assistant-bubble assistant">
            <div className="assistant-bubble-body muted">Thinking...</div>
          </div>
        )}
      </div>

      {(error || speech.error) && <p className="assistant-error">{error || speech.error}</p>}

      <form onSubmit={onSubmit} className="assistant-composer">
        <textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={onKeyDown}
          placeholder={speech.listening ? "Listening..." : "What's up?"}
          disabled={sending}
          aria-label="Message the assistant"
        />
        <button
          type="button"
          className={`capture-mic${speech.listening ? " listening" : ""}`}
          onClick={() => speech.toggle(draft)}
          disabled={sending || !speech.supported}
          aria-label={speech.listening ? "Stop listening" : "Talk"}
          title={
            !speech.supported
              ? "Voice isn't supported in this browser"
              : speech.listening
                ? "Stop listening"
                : "Talk"
          }
        >
          <MicIcon />
        </button>
        <button
          type="submit"
          className="capture-submit"
          disabled={sending || !draft.trim()}
          aria-label="Send"
          title="Send (or press Enter)"
        >
          <ArrowRightIcon />
        </button>
      </form>
    </div>
  );
}
