import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { api } from "../api/client";
import { branding } from "../config/branding";
import { useAssistantTts } from "../hooks/useAssistantTts";
import { DEFAULT_SILENCE_MS, useConversationMic } from "../hooks/useConversationMic";
import { useVoiceSession } from "../voice/VoiceSessionContext";
import { ArrowRightIcon, MicIcon } from "./icons";

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
 * Pull-up conversation. Opens on a glowing face. Words show as it talks.
 * The transcript stays up afterward — swipe or ✕ to leave.
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
  const [face, setFace] = useState<"live" | "thread">("live");
  const [caption, setCaption] = useState("");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressLiveRef = useRef(false);
  const dragStartY = useRef<number | null>(null);
  const dragYRef = useRef(0);
  const [dragY, setDragY] = useState(0);
  const [draggingSheet, setDraggingSheet] = useState(false);

  const { speaking: ttsSpeaking, speak: ttsSpeak, stop: ttsStop } = useAssistantTts(open);

  const clearReveal = useCallback(() => {
    if (revealTimer.current) {
      clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
  }, []);

  const revealSpoken = useCallback(
    (text: string, durationMs: number | null) => {
      clearReveal();
      const words = text.split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        setCaption("");
        return;
      }
      const total = durationMs && durationMs > 500 ? durationMs * 0.92 : words.length * 260;
      const step = total / words.length;
      let i = 0;
      setCaption("");
      const tick = () => {
        i += 1;
        setCaption(words.slice(0, i).join(" "));
        if (i < words.length) revealTimer.current = setTimeout(tick, step);
      };
      revealTimer.current = setTimeout(tick, Math.min(step, 90));
    },
    [clearReveal],
  );

  const showThread = useCallback(() => {
    suppressLiveRef.current = true;
    clearReveal();
    setCaption("");
    setFace("thread");
    window.setTimeout(() => {
      suppressLiveRef.current = false;
    }, 1800);
  }, [clearReveal]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
    });
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sendingRef.current) return;
      ttsStop();
      sendingRef.current = true;
      setSending(true);
      setError(null);
      setDraft("");
      setPartial("");
      setFace("live");
      setCaption("");
      clearReveal();

      const tempId = `temp-${Date.now()}`;
      setMessages((prev) => [...prev, { id: tempId, role: "user", content: trimmed }]);

      let replyText: string | null = null;
      try {
        const res = await api.post<{
          conversationId: string;
          message: { id: string; content: string };
          spoken?: string;
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
        replyText = res.spoken?.trim() || res.message.content;
      } catch (e) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setError(e instanceof Error ? e.message : "Something went wrong");
        setDraft(trimmed);
      } finally {
        sendingRef.current = false;
        setSending(false);
      }

      if (replyText) {
        const line = replyText;
        await ttsSpeak(line, { onStart: (ms) => revealSpoken(line, ms) });
        showThread();
      }
    },
    [clearReveal, conversationId, revealSpoken, showThread, ttsSpeak, ttsStop],
  );

  // Mute while thinking OR while the assistant is talking back.
  const mic = useConversationMic({
    active: open,
    muted: sending || ttsSpeaking,
    silenceMs: DEFAULT_SILENCE_MS,
    onUtterance: (text) => {
      void send(text);
    },
    onPartial: setPartial,
  });

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    setError(null);
    setFace("live");
    setCaption("");
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
  }, [open]);

  useEffect(() => {
    if (open) scrollToBottom();
  }, [messages, partial, sending, open, scrollToBottom]);

  useEffect(() => {
    if (suppressLiveRef.current) return;
    if (partial.trim() || mic.phase === "hearing") setFace("live");
  }, [partial, mic.phase]);

  useEffect(() => () => clearReveal(), [clearReveal]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") closeSession();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeSession]);

  async function onUndo(undo: NonNullable<ExecutedAction["undo"]>) {
    try {
      await api.post("/assistant/undo", undo);
      const content = "Undone.";
      setMessages((prev) => [...prev, { id: `undo-${Date.now()}`, role: "assistant", content, actions: null }]);
      setFace("live");
      await ttsSpeak(content, { onStart: (ms) => revealSpoken(content, ms) });
      showThread();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Undo failed");
    }
  }

  async function onNewChat() {
    ttsStop();
    setFace("live");
    setCaption("");
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

  function onSheetPointerDown(e: PointerEvent<HTMLElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragStartY.current = e.clientY;
    dragYRef.current = 0;
    setDraggingSheet(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onSheetPointerMove(e: PointerEvent<HTMLElement>) {
    if (dragStartY.current == null) return;
    const dy = Math.max(0, e.clientY - dragStartY.current);
    dragYRef.current = dy;
    setDragY(dy);
  }

  function onSheetPointerUp() {
    const shouldClose = dragYRef.current > 90;
    dragStartY.current = null;
    dragYRef.current = 0;
    setDraggingSheet(false);
    setDragY(0);
    if (shouldClose) closeSession();
  }

  function onDoneTalking() {
    if (ttsSpeaking) {
      ttsStop();
      showThread();
      return;
    }
    if (partial.trim()) mic.flushNow();
  }

  if (!open) return null;

  const hasSpeech = Boolean(partial.trim());
  const busy = sending || ttsSpeaking;
  const orbClass = ttsSpeaking
    ? "speaking"
    : mic.phase === "hearing"
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
    : ttsSpeaking
      ? "Talking… tap the glow to cut in"
      : mic.phase === "reconnecting"
        ? "Reconnecting mic…"
        : mic.phase === "hearing"
          ? "Hearing you"
          : mic.phase === "listening"
            ? "Listening"
            : mic.supported
              ? "Starting mic…"
              : "Type your message";

  const liveLine = ttsSpeaking || caption ? caption : partial;

  return (
    <div className="voice-sheet-root" role="dialog" aria-modal="true" aria-label={`Talk to ${branding.assistantName}`}>
      <button type="button" className="voice-sheet-backdrop" aria-label="Close conversation" onClick={closeSession} />
      <div
        className={`voice-sheet${draggingSheet ? " dragging" : ""}`}
        style={{ transform: dragY ? `translateY(${dragY}px)` : undefined }}
      >
        <header
          className="voice-sheet-header"
          onPointerDown={onSheetPointerDown}
          onPointerMove={onSheetPointerMove}
          onPointerUp={onSheetPointerUp}
          onPointerCancel={onSheetPointerUp}
        >
          <div className="voice-sheet-grab" aria-hidden />
          <div className="voice-sheet-title-row">
            <div>
              <h2>{branding.assistantName}</h2>
              {face === "thread" && <p className="voice-sheet-status">{statusLabel}</p>}
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

        {face === "live" ? (
          <div className="voice-live">
            {ttsSpeaking ? (
              <button
                type="button"
                className={`voice-orb hero ${orbClass}`.trim()}
                onClick={onDoneTalking}
                aria-label="Stop talking and listen"
              >
                <MicIcon />
              </button>
            ) : (
              <div className={`voice-orb hero ${orbClass}`.trim()} aria-hidden>
                <MicIcon />
              </div>
            )}
            <p className="voice-sheet-status">{statusLabel}</p>
            <p className="voice-live-caption">{liveLine}</p>
            {(ttsSpeaking || hasSpeech) && (
              <button
                type="button"
                className="voice-done-btn"
                onClick={onDoneTalking}
                disabled={sending && !ttsSpeaking}
                aria-label={ttsSpeaking ? "Stop speaking" : "Send now"}
              >
                {ttsSpeaking ? "Stop" : "Send now"}
              </button>
            )}
            {loaded && messages.length > 0 && !busy && (
              <button type="button" className="voice-sheet-text-btn" onClick={() => setFace("thread")}>
                Conversation
              </button>
            )}
          </div>
        ) : (
          <div className="voice-sheet-thread" ref={scrollerRef}>
            {!loaded && <p className="muted">Loading…</p>}
            {loaded && messages.length === 0 && <p className="muted">Nothing said yet.</p>}
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
            <button type="button" className="voice-sheet-text-btn voice-back-live" onClick={() => setFace("live")}>
              Back to talking
            </button>
          </div>
        )}

        {(error || mic.error) && <p className="assistant-error">{error || mic.error}</p>}

        <form className="voice-sheet-composer" onSubmit={onSubmit}>
          <textarea
            rows={1}
            value={draft}
            onChange={(e) => {
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
