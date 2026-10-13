import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { branding } from "../config/branding";
import { ArrowRightIcon, MicIcon } from "../components/icons";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";

interface EasyWin {
  id: string;
  title: string;
  estimateMinutes: number | null;
  assumedMinutes: number;
  importance: string;
  score: number;
}

interface ExecutedAction {
  type: string;
  ok: boolean;
  summary: string;
  taskId?: string;
  taskTitle?: string;
  undo?: { kind: "complete" | "drop" | "snooze" | "reopen"; taskId: string };
  easyWins?: EasyWin[];
  minutes?: number;
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

const SUGGESTIONS = [
  "I have 25 minutes — what can I knock out?",
  "What's on today?",
  "Cancel the drop party task",
  "I just watered the plants",
  "Snooze that package until Thursday",
];

export function HomePage() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [easyWins, setEasyWins] = useState<EasyWin[]>([]);
  const [easyWinsMinutes, setEasyWinsMinutes] = useState(25);
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

  const loadEasyWins = useCallback((minutes = 25) => {
    api
      .get<{ minutes: number; wins: EasyWin[] }>(`/assistant/easy-wins?minutes=${minutes}`)
      .then((r) => {
        setEasyWins(r.wins);
        setEasyWinsMinutes(r.minutes);
      })
      .catch(() => {
        /* non-fatal — home still works without the strip */
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
            actions: m.actions ?? null,
          }))
        );
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    loadEasyWins(25);
  }, [loadEasyWins]);

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
      // Refresh the home strip after any mutation.
      if (res.executed.some((e) => e.ok && ["create_tasks", "complete", "drop", "snooze", "reopen", "add_to_today", "easy_wins"].includes(e.type))) {
        const winAction = res.executed.find((e) => e.type === "easy_wins" && e.ok);
        loadEasyWins(winAction?.minutes ?? easyWinsMinutes);
      }
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
        { id: `undo-${Date.now()}`, role: "assistant", content: "Undone.", actions: null },
      ]);
      loadEasyWins(easyWinsMinutes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Undo failed");
    }
  }

  async function completeWin(win: EasyWin) {
    try {
      await api.post(`/tasks/${win.id}/complete`);
      setMessages((prev) => [
        ...prev,
        {
          id: `win-${Date.now()}`,
          role: "assistant",
          content: `Nice — marked "${win.title}" done.`,
          actions: [{ type: "complete", ok: true, summary: `Marked "${win.title}" done`, taskId: win.id, taskTitle: win.title, undo: { kind: "complete", taskId: win.id } }],
        },
      ]);
      loadEasyWins(easyWinsMinutes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't complete that");
    }
  }

  async function onNewChat() {
    try {
      const c = await api.post<Conversation>("/assistant/conversation/new", {});
      setConversationId(c.id);
      setMessages([]);
      setError(null);
      loadEasyWins(25);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start a new chat");
    }
  }

  function winsFromMessage(m: ChatMessage): EasyWin[] {
    return m.actions?.find((a) => a.type === "easy_wins" && a.ok)?.easyWins ?? [];
  }

  if (loading) return <p className="muted">Loading...</p>;

  return (
    <div className="page assistant-page home-page">
      <header className="assistant-header">
        <div>
          <h1>{branding.appName}</h1>
          <p className="orientation">Talk or type. I remember, sort, and help you knock things out.</p>
        </div>
        <button type="button" className="assistant-new" onClick={onNewChat} title="New conversation">
          New chat
        </button>
      </header>

      {messages.length === 0 && easyWins.length > 0 && (
        <section className="easy-wins-strip" aria-label="Easy wins">
          <div className="easy-wins-head">
            <h2>Easy wins</h2>
            <span className="muted small">~{easyWinsMinutes} min</span>
          </div>
          <ul className="easy-wins-list">
            {easyWins.map((w) => (
              <li key={w.id}>
                <button type="button" className="easy-win-chip" onClick={() => completeWin(w)} title="Mark done">
                  <span className="easy-win-title">{w.title}</span>
                  <span className="easy-win-meta">
                    {w.estimateMinutes != null ? `~${w.estimateMinutes}m` : `~${w.assumedMinutes}m?`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="assistant-thread" ref={scrollerRef}>
        {messages.length === 0 && (
          <div className="assistant-empty">
            <p className="assistant-empty-lead">What's up?</p>
            <div className="assistant-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="assistant-suggestion" onClick={() => send(s)} disabled={sending}>
                  {s}
                </button>
              ))}
            </div>
            <p className="muted small">
              Lists live under <Link to="/today">Today</Link> if you want the board view.
            </p>
          </div>
        )}

        {messages.map((m) => {
          const undoable = m.actions?.filter((a) => a.ok && a.undo) ?? [];
          const msgWins = winsFromMessage(m);
          return (
            <div key={m.id} className={`assistant-bubble ${m.role}`}>
              <div className="assistant-bubble-body">{m.content}</div>
              {msgWins.length > 0 && (
                <ul className="easy-wins-list in-bubble">
                  {msgWins.map((w) => (
                    <li key={w.id}>
                      <button type="button" className="easy-win-chip" onClick={() => completeWin(w)}>
                        <span className="easy-win-title">{w.title}</span>
                        <span className="easy-win-meta">
                          {w.estimateMinutes != null ? `~${w.estimateMinutes}m` : `~${w.assumedMinutes}m?`} · Done
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
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
          aria-label={`Talk to ${branding.assistantName}`}
        />
        <button
          type="button"
          className={`capture-mic${speech.listening ? " listening" : ""}`}
          onClick={() => speech.toggle(draft)}
          disabled={sending || !speech.supported}
          aria-label={speech.listening ? "Stop listening" : "Talk"}
          title={!speech.supported ? "Voice isn't supported in this browser" : speech.listening ? "Stop listening" : "Talk"}
        >
          <MicIcon />
        </button>
        <button type="submit" className="capture-submit" disabled={sending || !draft.trim()} aria-label="Send" title="Send (or press Enter)">
          <ArrowRightIcon />
        </button>
      </form>
    </div>
  );
}
