import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import { useVoiceSession } from "../voice/VoiceSessionContext";

type Phase = "connecting" | "listening" | "speaking" | "thinking" | "reconnecting" | "ended" | "failed";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface LiveConversation {
  id: string;
  personalityId: string;
  messages: ChatMessage[];
}

const PHASE_LABEL: Record<Phase, string> = {
  connecting: "Connecting",
  listening: "Listening",
  speaking: "Speaking",
  thinking: "Thinking",
  reconnecting: "Reconnecting",
  ended: "Ended",
  failed: "Connection failed",
};

function waitForIce(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, 2500);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        window.clearTimeout(timer);
        resolve();
      }
    });
  });
}

export function LiveSheet() {
  const { mode, closeSession, openQuick } = useVoiceSession();
  const open = mode === "live";
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [personality, setPersonality] = useState("Puck");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [phase, setPhase] = useState<Phase>("ended");
  const [caption, setCaption] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [generation, setGeneration] = useState(0);
  const desiredId = useRef<string | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const sessionRef = useRef<string | null>(null);
  const attempts = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);

  const loadConversation = useCallback(async () => {
    const conversation = await api.get<LiveConversation>("/assistant/live/conversation");
    setConversationId(conversation.id);
    setMessages(conversation.messages ?? []);
    const people = await api.get<Array<{ id: string; name: string }>>("/assistant/personalities");
    setPersonality(people.find((person) => person.id === conversation.personalityId)?.name ?? "Puck");
    return conversation.id;
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let mic: MediaStream | null = null;
    let poll = 0;
    let speakTimer = 0;
    let seenChange = -1;

    function stopMedia() {
      window.clearInterval(poll);
      window.clearTimeout(speakTimer);
      dcRef.current = null;
      mic?.getTracks().forEach((track) => track.stop());
      mic = null;
      pc?.close();
      pc = null;
    }

    async function endServer() {
      const id = sessionRef.current;
      sessionRef.current = null;
      if (id) await api.delete(`/assistant/live/sessions/${id}`).catch(() => undefined);
    }

    function onEvent(raw: string) {
      let event: { type?: string; delta?: string };
      try {
        event = JSON.parse(raw);
      } catch {
        return;
      }
      if (event.type === "session.output_transcript.delta" && event.delta) {
        setPhase("speaking");
        setCaption((current) => `${current}${event.delta}`);
        window.clearTimeout(speakTimer);
        speakTimer = window.setTimeout(() => setPhase("listening"), 1200);
      } else if (event.type === "session.input_transcript.delta") {
        setPhase("listening");
        setCaption("");
      } else if (event.type === "session.delegation.created") {
        setPhase("thinking");
      } else if (event.type === "session.paused" || event.type === "session.resumed") {
        setPhase("listening");
      }
    }

    function stopStream(stream: MediaStream | null) {
      stream?.getTracks().forEach((track) => track.stop());
    }

    async function connect(id: string, retry: boolean) {
      const ready = await api.get<{ ready: boolean }>("/assistant/live/ready").catch(() => ({ ready: false }));
      if (cancelled) return;
      if (!ready.ready) {
        setPhase("failed");
        setError("Voice needs the server key. You can still type.");
        return;
      }
      setPhase(retry ? "reconnecting" : "connecting");
      setError(null);
      const micRequest = navigator.mediaDevices.getUserMedia({ audio: true });
      const micTimeout = new Promise<MediaStream>((_, reject) => {
        window.setTimeout(() => reject(new Error("mic_timeout")), 8000);
      });
      try {
        mic = await Promise.race([micRequest, micTimeout]);
      } catch (err) {
        void micRequest.then((stream) => stopStream(stream)).catch(() => undefined);
        if (cancelled) return;
        const blocked = err instanceof Error && err.message === "mic_timeout";
        setPhase("failed");
        setError(blocked ? "Allow the microphone, or type." : "The microphone was blocked. You can still type.");
        return;
      }
      if (cancelled) {
        stopStream(mic);
        mic = null;
        return;
      }
      pc = new RTCPeerConnection();
      mic.getTracks().forEach((track) => pc?.addTrack(track, mic!));
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = (message) => onEvent(String(message.data));
      const offer = await pc.createOffer();
      if (cancelled) {
        stopMedia();
        return;
      }
      await pc.setLocalDescription(offer);
      await waitForIce(pc);
      if (cancelled) {
        stopMedia();
        return;
      }
      const answer = await api.post<{ sdp: string; sessionId: string; personalityId: string }>(
        "/assistant/live/sessions",
        { sdp: pc.localDescription?.sdp ?? "", conversationId: id },
      );
      if (cancelled) {
        await api.delete(`/assistant/live/sessions/${answer.sessionId}`).catch(() => undefined);
        stopMedia();
        return;
      }
      sessionRef.current = answer.sessionId;
      await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
      setPhase("listening");
      attempts.current = 0;
      pc.onconnectionstatechange = () => {
        const state = pc?.connectionState;
        if (cancelled || (state !== "failed" && state !== "disconnected")) return;
        if (attempts.current >= 3) {
          setPhase("failed");
          setError("The call dropped. Try again.");
          return;
        }
        attempts.current += 1;
        const nextId = id;
        void endServer().then(() => {
          stopMedia();
          connect(nextId, true).catch(() => setPhase("failed"));
        });
      };
      seenChange = -1;
      poll = window.setInterval(() => {
        const current = sessionRef.current;
        if (!current) return;
        api
          .get<{ changeSeq: number }>(`/assistant/live/sessions/${current}`)
          .then((row) => {
            if (seenChange >= 0 && row.changeSeq !== seenChange) {
              window.dispatchEvent(new CustomEvent("taskr-tasks-changed"));
              api.get<LiveConversation>(`/assistant/live/conversation`).then((conversation) => {
                if (conversation.id === id) setMessages(conversation.messages ?? []);
              }).catch(() => undefined);
            }
            seenChange = row.changeSeq;
          })
          .catch(() => undefined);
      }, 2000);
    }

    const onHide = () => {
      if (document.visibilityState === "hidden" && sessionRef.current) closeSession();
    };
    document.addEventListener("visibilitychange", onHide);

    const startId = desiredId.current;
    desiredId.current = null;
    const ready = startId ? Promise.resolve(startId) : loadConversation();
    ready
      .then((id) => {
        if (!cancelled) return connect(id, false);
      })
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : "Could not start the conversation.";
        setError(message.includes("live_unavailable") ? "Voice needs the server key. You can still type." : message);
        setPhase("failed");
      });

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onHide);
      stopMedia();
      void endServer();
    };
  }, [open, generation, closeSession, loadConversation]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, caption]);

  if (!open) return null;

  function interrupt() {
    dcRef.current?.send(
      JSON.stringify({
        type: "session.instructions.append",
        event_id: `stop-${Date.now()}`,
        delegation_id: null,
        content: "The user interrupted. Stop speaking now and listen.",
      }),
    );
    setPhase("listening");
    setCaption("");
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !conversationId) return;
    setDraft("");
    setSending(true);
    setMessages((current) => [...current, { id: `local-${Date.now()}`, role: "user", content: text }]);
    try {
      const result = await api.post<{ message: ChatMessage; tasksChanged: boolean }>("/assistant/live/text", {
        text,
        conversationId,
      });
      setMessages((current) => [...current, result.message]);
      if (result.tasksChanged) window.dispatchEvent(new CustomEvent("taskr-tasks-changed"));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Message failed");
    } finally {
      setSending(false);
    }
  }

  async function onNew() {
    const created = await api.post<LiveConversation>("/assistant/live/conversation");
    const people = await api.get<Array<{ id: string; name: string }>>("/assistant/personalities");
    desiredId.current = created.id;
    setMessages([]);
    setConversationId(created.id);
    setPersonality(people.find((person) => person.id === created.personalityId)?.name ?? "Puck");
    setGeneration((value) => value + 1);
  }

  return (
    <div className="voice-sheet-root" role="dialog" aria-modal="true" aria-label={`Talk with ${personality}`}>
      <button type="button" className="voice-sheet-backdrop" aria-label="Close conversation" onClick={closeSession} />
      <div className="voice-sheet">
        <header className="voice-sheet-header">
          <div className="voice-sheet-grab" aria-hidden />
          <div className="voice-sheet-title-row">
            <div>
              <h2>{personality}</h2>
              <p className="voice-sheet-status">{PHASE_LABEL[phase]}</p>
            </div>
            <div className="voice-sheet-actions">
              <button type="button" className="voice-sheet-text-btn" onClick={openQuick}>
                Quick talk
              </button>
              <button type="button" className="voice-sheet-text-btn" onClick={onNew}>
                New
              </button>
              <button type="button" className="voice-sheet-close" onClick={closeSession} aria-label="Close">
                ✕
              </button>
            </div>
          </div>
        </header>
        <div className="voice-sheet-thread" ref={scroller}>
          {messages.map((message) => (
            <p key={message.id} className={`assistant-bubble ${message.role}`}>
              {message.content}
            </p>
          ))}
          {caption && <p className="voice-live-caption">{caption}</p>}
          {error && <p className="voice-sheet-status">{error}</p>}
        </div>
        <div className="voice-sheet-controls">
          <button type="button" className="voice-done-btn" onClick={interrupt} disabled={phase !== "speaking"}>
            Stop speaking
          </button>
          <form className="voice-sheet-composer" onSubmit={onSubmit}>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Or type"
              rows={2}
            />
            <button type="submit" disabled={sending || !draft.trim()}>
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
