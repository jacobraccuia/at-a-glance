import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import { PersonalityMark } from "./icons";
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
  connecting: "Starting",
  listening: "Listening",
  speaking: "Listening",
  thinking: "Listening",
  reconnecting: "Starting",
  ended: "Ended",
  failed: "Connection failed",
};

interface HeldMic {
  stream: MediaStream;
  release: () => void;
  stop: () => void;
  level: () => number;
}

function rms(samples: Float32Array) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

/** Mic is live immediately. The outbound track stays silent until release, then the saved speech goes first. */
function holdMic(raw: MediaStream): HeldMic {
  const ctx = new AudioContext();
  void ctx.resume();
  const source = ctx.createMediaStreamSource(raw);
  const dest = ctx.createMediaStreamDestination();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const processor = ctx.createScriptProcessor(1024, 1, 1);
  const chunks: Float32Array[] = [];
  let queued = 0;
  let openGate = false;
  let stopped = false;
  const rate = ctx.sampleRate || 48000;
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const copy = new Float32Array(input);
    chunks.push(copy);
    queued += copy.length;
    const cap = rate * 10;
    while (queued > cap && chunks.length > 0) queued -= chunks.shift()?.length ?? 0;
    const out = event.outputBuffer.getChannelData(0);
    out.fill(0);
    if (!openGate) return;
    let offset = 0;
    while (offset < out.length && chunks.length > 0) {
      const head = chunks[0];
      if (queued / rate > 0.4 && rms(head) < 0.012) {
        queued -= head.length;
        chunks.shift();
        continue;
      }
      const take = Math.min(head.length, out.length - offset);
      out.set(head.subarray(0, take), offset);
      offset += take;
      queued -= take;
      if (take === head.length) chunks.shift();
      else chunks[0] = head.subarray(take);
    }
  };
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(dest);
  processor.connect(mute);
  mute.connect(ctx.destination);
  const wave = new Uint8Array(analyser.fftSize);
  return {
    stream: dest.stream,
    release() {
      openGate = true;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      processor.disconnect();
      source.disconnect();
      raw.getTracks().forEach((track) => track.stop());
      void ctx.close();
    },
    level() {
      analyser.getByteTimeDomainData(wave);
      let sum = 0;
      for (const value of wave) {
        const sample = (value - 128) / 128;
        sum += sample * sample;
      }
      return Math.min(1, Math.sqrt(sum / wave.length) * 4);
    },
  };
}

function waitUntilSendable(pc: RTCPeerConnection) {
  const deadline = Date.now() + 2000;
  return new Promise<void>((resolve) => {
    const tick = () => {
      if (
        pc.connectionState === "connected" ||
        pc.iceConnectionState === "connected" ||
        pc.iceConnectionState === "completed" ||
        Date.now() >= deadline
      ) {
        resolve();
        return;
      }
      window.setTimeout(tick, 50);
    };
    tick();
  });
}

function personaKey(name: string) {
  const key = name.trim().toLowerCase();
  return key === "atlas" || key === "sage" || key === "mercury" || key === "logos" ? key : "puck";
}

function PersonaOrb({
  name,
  level,
  live,
  speaking,
  mini = false,
  label,
}: {
  name: string;
  level: number;
  live: boolean;
  speaking: boolean;
  mini?: boolean;
  label?: string;
}) {
  return (
    <div
      className={`persona-orb ${personaKey(name)}${live ? " live" : ""}${speaking ? " speaking" : ""}${mini ? " mini" : ""}`}
      style={{ ["--level" as string]: String(level) }}
      role="status"
      aria-label={label}
    >
      <i />
      <i />
      <i />
    </div>
  );
}

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
  const { mode, closeSession } = useVoiceSession();
  const open = mode === "live";
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [personality, setPersonality] = useState("Puck");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [phase, setPhase] = useState<Phase>("ended");
  const [caption, setCaption] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [level, setLevel] = useState(0);
  const [generation, setGeneration] = useState(0);
  const desiredId = useRef<string | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const sessionRef = useRef<string | null>(null);
  const attempts = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<Phase>("ended");
  phaseRef.current = phase;

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
    let mic: HeldMic | null = null;
    let poll = 0;
    let speakTimer = 0;
    let levelTimer = 0;
    let seenChange = -1;

    function stopMedia() {
      window.clearInterval(poll);
      window.clearInterval(levelTimer);
      window.clearTimeout(speakTimer);
      dcRef.current = null;
      mic?.stop();
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
        appendSpoken("assistant", event.delta);
        window.clearTimeout(speakTimer);
        speakTimer = window.setTimeout(() => setPhase("listening"), 1200);
      } else if (event.type === "session.input_transcript.delta") {
        setPhase("listening");
        appendSpoken("user", event.delta ?? "");
      } else if (event.type === "session.delegation.created") {
        setPhase("thinking");
      } else if (event.type === "session.paused" || event.type === "session.resumed") {
        setPhase("listening");
      }
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
      const micTimeout = new Promise<HeldMic>((_, reject) => {
        window.setTimeout(() => reject(new Error("mic_timeout")), 8000);
      });
      try {
        mic = retry
          ? holdMic(await navigator.mediaDevices.getUserMedia({ audio: true }))
          : await Promise.race([micPromise, micTimeout]);
        window.clearInterval(levelTimer);
        levelTimer = window.setInterval(() => setLevel(mic?.level() ?? 0), 80);
      } catch (err) {
        void micPromise.then((held) => held.stop()).catch(() => undefined);
        if (cancelled) return;
        const blocked = err instanceof Error && err.message === "mic_timeout";
        setPhase("failed");
        setError(blocked ? "Allow the microphone, or type." : "The microphone was blocked. You can still type.");
        return;
      }
      if (cancelled) {
        mic?.stop();
        mic = null;
        return;
      }
      pc = new RTCPeerConnection();
      mic.stream.getTracks().forEach((track) => pc?.addTrack(track, mic!.stream));
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
      await waitUntilSendable(pc);
      if (cancelled) return;
      mic?.release();
      setPhase("listening");
      attempts.current = 0;
      pc.onconnectionstatechange = () => {
        const state = pc?.connectionState;
        if (cancelled || (state !== "failed" && state !== "disconnected")) return;
        if (phaseRef.current === "listening") {
          closeSession();
          return;
        }
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
                if (conversation.id !== id) return;
                setMessages((local) => {
                  const saved = conversation.messages ?? [];
                  const tail = local.filter((message) => message.id.startsWith("live-"));
                  const last = saved[saved.length - 1];
                  const extra = tail.filter((message) => !(last && last.role === message.role && last.content === message.content));
                  return [...saved, ...extra];
                });
              }).catch(() => undefined);
            }
            seenChange = row.changeSeq;
          })
          .catch(() => undefined);
      }, 2000);
    }

    const micPromise = navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => holdMic(stream));

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
      void micPromise.then((held) => held.stop()).catch(() => undefined);
      stopMedia();
      void endServer();
    };
  }, [open, generation, closeSession, loadConversation]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, caption]);

  useEffect(() => {
    if (mode !== "live" || phase !== "listening") return;
    const timer = window.setTimeout(() => closeSession(), 20_000);
    return () => window.clearTimeout(timer);
  }, [mode, phase, closeSession]);

  if (!open) return null;

  if (minimized) {
    return (
      <div className="voice-minibar" role="status">
        <button type="button" className="voice-minibar-open" onClick={() => setMinimized(false)}>
          <PersonaOrb name={personality} level={level} live={phase === "listening" || phase === "speaking" || phase === "thinking"} speaking={phase === "speaking"} mini />
          <strong>{personality}</strong>
        </button>
        <button type="button" className="voice-sheet-close" onClick={closeSession} aria-label="Close">
          ✕
        </button>
      </div>
    );
  }

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
    setMessages((current) => current.map((message) => (message.id.startsWith("live-") ? { ...message, id: `kept-${message.id}` } : message)));
  }

  function appendSpoken(role: "user" | "assistant", delta: string) {
    if (!delta) return;
    setMessages((current) => {
      const last = current[current.length - 1];
      if (last?.id.startsWith("live-") && last.role === role) {
        return [...current.slice(0, -1), { ...last, content: last.content + delta }];
      }
      const kept = current.map((message) => (message.id.startsWith("live-") ? { ...message, id: `kept-${message.id}` } : message));
      return [...kept, { id: `live-${role}`, role, content: delta }];
    });
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
              <h2>
                <PersonalityMark name={personality} />
                {personality}
              </h2>
            </div>
            <div className="voice-sheet-actions">
              <button type="button" className="voice-sheet-text-btn" onClick={onNew}>
                New
              </button>
              <button type="button" className="voice-sheet-close" onClick={() => setMinimized(true)} aria-label="Minimize">
                ▾
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
              <span className="assistant-bubble-body">{message.content}</span>
            </p>
          ))}
          {caption && <p className="voice-live-caption">{caption}</p>}
          {error && <p className="voice-sheet-status">{error}</p>}
        </div>
        <PersonaOrb
          name={personality}
          level={level}
          live={phase === "listening" || phase === "speaking" || phase === "thinking"}
          speaking={phase === "speaking"}
          label={phase === "failed" ? PHASE_LABEL.failed : phase === "listening" || phase === "speaking" || phase === "thinking" ? "Listening" : "Connecting"}
        />
        {phase === "speaking" && (
          <button type="button" className="persona-stop" onClick={interrupt}>
            Stop
          </button>
        )}
        <div className="voice-sheet-controls">
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
