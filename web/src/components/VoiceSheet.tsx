import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api } from "../api/client";
import { branding } from "../config/branding";
import { DEFAULT_SILENCE_MS, useConversationMic } from "../hooks/useConversationMic";
import { useVoiceSession } from "../voice/VoiceSessionContext";
import { ArrowRightIcon, MicIcon } from "./icons";

const IDLE_CLOSE_MS = 30_000;

interface EasyWin {
  id: string;
  title: string;
  estimateMinutes: number | null;
  assumedMinutes: number;
}

interface ExecutedAction {
  type: string;
  ok: boolean;
  summary: string;
  taskId?: string;
  undo?: { kind: "complete" | "drop" | "snooze" | "reopen"; taskId: string };
  easyWins?: EasyWin[];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: ExecutedAction[] | null;
}

interface Conversation {
  id: string;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    actions?: ExecutedAction[] | null;
  }>;
}

/**
 * Pull-up conversation sheet. Voice-first: longer pause or "Done talking"
 * ends a turn. Mic stays warm while the assistant thinks (mobile-safe).
 */
export function VoiceSheet() {
  const { open, closeSession } = useVoiceSession();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [partial, setPartial] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [lastActivity, setLastActivity] = useState(Date.now());
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);

  const bumpActivity = useCallback(() => setLastActivity(Date.now()), []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
    });
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sendingRef.current) return;
      sendingRef.current = true;
      setSending(true);
      setError(null);
      setDraft("");
      setPartial("");
      bumpActivity();

      const tempId = `temp-${Date.now()}`;
      setMessages((prev) => [...prev, { id: tempId, role: "user", content: trimmed }]);

      try {
        const res = await api.post<{
          conversationId: string;
          message: { id: string; content: string };
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
        bumpActivity();
      } catch (e) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setError(e instanceof Error ? e.message : "Something went wrong");
        setDraft(trimmed);
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [bumpActivity, conversationId],
  );

  // Keep mic warm while thinking — only mute acceptance, don't tear down.
  const mic = useConversationMic({
    active: open,
    muted: sending,
    silenceMs: DEFAULT_SILENCE_MS,
    onUtterance: (text) => {
      void send(text);
    },
    onPartial: setPartial,
    onActivity: bumpActivity,
  });

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    setError(null);
    bumpActivity();
    api
      .get<Conversation>("/assistant/conversation")
      .then((c) => {
        setConversationId(c.id);
        setMessages(
          c.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            actions: m.actions ?? null,
          })),
        );
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  }, [open, bumpActivity]);

  useEffect(() => {
    if (open) scrollToBottom();
  }, [messages, partial, sending, open, scrollToBottom]);

  useEffect(() => {
    if (!open) return;
    const remaining = IDLE_CLOSE_MS - (Date.now() - lastActivity);
    const t = setTimeout(() => closeSession(), Math.max(0, remaining));
    return () => clearTimeout(t);
  }, [open, lastActivity, closeSession]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") closeSession();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeSession]);

  async function onUndo(undo: NonNullable<ExecutedAction["undo"]>) {
    bumpActivity();
    try {
      await api.post("/assistant/undo", undo);
      setMessages((prev) => [
        ...prev,
        { id: `undo-${Date.now()}`, role: "assistant", content: "Undone.", actions: null },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Undo failed");
    }
  }

  async function onNewChat() {
    bumpActivity();
    try {
      const c = await api.post<Conversation>("/assistant/conversation/new", {});
      setConversationId(c.id);
      setMessages([]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start a new chat");
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  }

  function onDoneTalking() {
    bumpActivity();
    if (partial.trim()) {
      mic.flushNow();
    }
  }

  if (!open) return null;

  const hasSpeech = Boolean(partial.trim());
  const orbClass =
    mic.phase === "hearing"
      ? "hearing"
      : mic.phase === "muted"
        ? "muted"
        : mic.phase === "reconnecting"
          ? "reconnect"
          : mic.phase === "listening"
            ? "live"
            : "";

  const statusLabel = sending
    ? "Thinking…"
    : mic.phase === "reconnecting"
      ? "Reconnecting mic…"
      : mic.phase === "hearing"
        ? "Got it — pause or tap Done when finished"
        : mic.phase === "listening"
          ? "Listening — take your time"
          : mic.supported
            ? "Starting mic…"
            : "Type your message";

  return (
    <div className="voice-sheet-root" role="dialog" aria-modal="true" aria-label={`Talk to ${branding.assistantName}`}>
      <button type="button" className="voice-sheet-backdrop" aria-label="Close conversation" onClick={closeSession} />
      <div className="voice-sheet">
        <header className="voice-sheet-header">
          <div className="voice-sheet-grab" aria-hidden />
          <div className="voice-sheet-title-row">
            <div>
              <h2>{branding.assistantName}</h2>
              <p className="voice-sheet-status">{statusLabel}</p>
            </div>
            <div className="voice-sheet-actions">
              <button type="button" className="voice-sheet-text-btn" onClick={onNewChat}>
                New
              </button>
              <button type="button" className="voice-sheet-close" onClick={closeSession} aria-label="Close">
                ✕
              </button>
            </div>
          </div>
        </header>

        <div className="voice-sheet-thread" ref={scrollerRef}>
          {!loaded && <p className="muted">Loading…</p>}
          {loaded && messages.length === 0 && !partial && (
            <div className="voice-sheet-empty">
              <div className={`voice-orb ${orbClass}`.trim()} aria-hidden>
                <MicIcon />
              </div>
              <p>Talk when you're ready. Pause a beat — or tap Done — and I'll reply.</p>
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
          {partial && !sending && (
            <div className="assistant-bubble user partial">
              <div className="assistant-bubble-body">{partial}</div>
            </div>
          )}
          {sending && (
            <div className="assistant-bubble assistant">
              <div className="assistant-bubble-body muted">Thinking…</div>
            </div>
          )}
        </div>

        {(error || mic.error) && <p className="assistant-error">{error || mic.error}</p>}

        <div className="voice-sheet-controls">
          <div className={`voice-orb compact ${orbClass}`.trim()} aria-hidden>
            <MicIcon />
          </div>
          <button
            type="button"
            className="voice-done-btn"
            onClick={onDoneTalking}
            disabled={sending || !hasSpeech}
            aria-label="Done talking"
          >
            Done talking
          </button>
        </div>

        <form className="voice-sheet-composer" onSubmit={onSubmit} onFocus={bumpActivity}>
          <textarea
            rows={1}
            value={draft}
            onChange={(e) => {
              bumpActivity();
              setDraft(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={onKeyDown}
            placeholder={mic.supported ? "Or type…" : "Type a message…"}
            disabled={sending}
            aria-label="Type a message"
          />
          <button type="submit" className="capture-submit" disabled={sending || !draft.trim()} aria-label="Send">
            <ArrowRightIcon />
          </button>
        </form>
      </div>
    </div>
  );
}
