import { useCallback, useEffect, useRef, useState } from "react";

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: ((ev?: Event) => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Pause that ends a turn. Short enough that a finished sentence sends. */
export const DEFAULT_SILENCE_MS = 1200;
const RESTART_DELAY_MS = 600;
const AUDIO_CAPTURE_BACKOFF_MS = [700, 1400, 2800, 4500];

export type MicPhase = "off" | "listening" | "hearing" | "reconnecting" | "muted";

export interface ConversationMicOptions {
  /** Sheet open — keep (or recover) the mic session. */
  active: boolean;
  /** While assistant is thinking: stay warm, ignore new utterances. */
  muted?: boolean;
  silenceMs?: number;
  onUtterance: (text: string) => void;
  onPartial?: (text: string) => void;
  onActivity?: () => void;
}

/**
 * Conversation mic: keep the session warm across turns (don't tear down
 * while the assistant thinks — that caused iOS "No microphone found").
 * Pause ≈ end of turn; flushNow() for an explicit "Done talking" tap.
 */
export function useConversationMic(opts: ConversationMicOptions) {
  const {
    active,
    muted = false,
    silenceMs = DEFAULT_SILENCE_MS,
    onUtterance,
    onPartial,
    onActivity,
  } = opts;

  const [listening, setListening] = useState(false);
  const [phase, setPhase] = useState<MicPhase>("off");
  const [error, setError] = useState<string | null>(null);
  const [supported] = useState(() => Boolean(getSpeechRecognitionCtor()));

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wantListenRef = useRef(false);
  const mutedRef = useRef(muted);
  const finalsRef = useRef("");
  const partialRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emittingRef = useRef(false);
  const captureFailsRef = useRef(0);
  const startingRef = useRef(false);

  const onUtteranceRef = useRef(onUtterance);
  const onPartialRef = useRef(onPartial);
  const onActivityRef = useRef(onActivity);
  onUtteranceRef.current = onUtterance;
  onPartialRef.current = onPartial;
  onActivityRef.current = onActivity;
  mutedRef.current = muted;

  function clearSilence() {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }

  function clearRestart() {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }

  function clearBuffers() {
    finalsRef.current = "";
    partialRef.current = "";
    onPartialRef.current?.("");
  }

  const emitUtteranceRef = useRef(() => {});
  emitUtteranceRef.current = () => {
    // Prefer committed finals; fall back to live partial so "Done talking" works mid-phrase.
    const text = (finalsRef.current || partialRef.current).trim();
    clearSilence();
    if (!text || emittingRef.current || mutedRef.current) return;
    emittingRef.current = true;
    finalsRef.current = "";
    partialRef.current = "";
    onPartialRef.current?.("");
    onUtteranceRef.current(text);
    setTimeout(() => {
      emittingRef.current = false;
    }, 0);
  };

  const flushNow = useCallback(() => {
    if (mutedRef.current) return;
    emitUtteranceRef.current();
  }, []);

  function scheduleSilenceFlush() {
    if (mutedRef.current) return;
    clearSilence();
    silenceTimerRef.current = setTimeout(() => {
      emitUtteranceRef.current();
    }, silenceMs);
  }

  function hardStop() {
    clearSilence();
    clearRestart();
    startingRef.current = false;
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      try {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.abort();
      } catch {
        try {
          rec.stop();
        } catch {
          // already stopped
        }
      }
    }
    setListening(false);
    setPhase("off");
  }

  function scheduleRestart(delayMs: number) {
    clearRestart();
    restartTimerRef.current = setTimeout(() => {
      if (wantListenRef.current) startRecognition();
    }, delayMs);
  }

  function startRecognition() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor || !wantListenRef.current) return;
    if (recognitionRef.current || startingRef.current) return;

    startingRef.current = true;
    setError(null);

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";

    rec.onresult = (ev) => {
      if (mutedRef.current) return;
      onActivityRef.current?.();
      let interim = "";
      let gotFinal = false;
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const chunk = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) {
          finalsRef.current = `${finalsRef.current} ${chunk}`.replace(/\s+/g, " ").trim();
          gotFinal = true;
        } else {
          interim += chunk;
        }
      }
      const shown = `${finalsRef.current}${interim ? ` ${interim}` : ""}`.trim();
      partialRef.current = shown;
      onPartialRef.current?.(shown);
      setPhase(shown ? "hearing" : "listening");
      if (gotFinal || interim) scheduleSilenceFlush();
    };

    rec.onerror = (ev) => {
      startingRef.current = false;
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        setError("Microphone permission denied.");
        wantListenRef.current = false;
        hardStop();
        return;
      }
      if (ev.error === "audio-capture") {
        // Mic still releasing from the previous session (common on iOS).
        // Retry with backoff — do NOT kill the conversation.
        captureFailsRef.current += 1;
        const idx = Math.min(captureFailsRef.current - 1, AUDIO_CAPTURE_BACKOFF_MS.length - 1);
        const delay = AUDIO_CAPTURE_BACKOFF_MS[idx];
        setPhase("reconnecting");
        setError(captureFailsRef.current >= 3 ? "Reconnecting mic…" : null);
        recognitionRef.current = null;
        setListening(false);
        if (wantListenRef.current) scheduleRestart(delay);
        return;
      }
      if (ev.error !== "aborted" && ev.error !== "no-speech") {
        setError(`Voice error: ${ev.error}`);
      }
    };

    rec.onend = () => {
      startingRef.current = false;
      recognitionRef.current = null;
      setListening(false);
      if (!wantListenRef.current) {
        setPhase("off");
        return;
      }
      if (mutedRef.current) {
        setPhase("muted");
        // Stay warm: restart even while muted so we're ready when thinking ends.
        scheduleRestart(RESTART_DELAY_MS);
        return;
      }
      setPhase("reconnecting");
      scheduleRestart(RESTART_DELAY_MS);
    };

    try {
      rec.start();
      recognitionRef.current = rec;
      startingRef.current = false;
      captureFailsRef.current = 0;
      setListening(true);
      setPhase(mutedRef.current ? "muted" : "listening");
      setError(null);
    } catch {
      startingRef.current = false;
      recognitionRef.current = null;
      setListening(false);
      setPhase("reconnecting");
      scheduleRestart(RESTART_DELAY_MS + 200);
    }
  }

  // Sheet open/close.
  useEffect(() => {
    wantListenRef.current = active;
    if (active) {
      emittingRef.current = false;
      captureFailsRef.current = 0;
      startRecognition();
    } else {
      hardStop();
      clearBuffers();
      setError(null);
    }
    return () => {
      wantListenRef.current = false;
      hardStop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Thinking: mute acceptance, keep mic warm (no tear-down).
  useEffect(() => {
    mutedRef.current = muted;
    if (!active) return;
    if (muted) {
      clearSilence();
      clearBuffers();
      setPhase(listening ? "muted" : "reconnecting");
    } else {
      setPhase(listening ? "listening" : "reconnecting");
      if (!recognitionRef.current && wantListenRef.current) {
        scheduleRestart(RESTART_DELAY_MS);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted, active]);

  // Recover after backgrounding.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "visible" && wantListenRef.current) {
        onActivityRef.current?.();
        if (!recognitionRef.current) scheduleRestart(RESTART_DELAY_MS);
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Screen wake lock while session open.
  useEffect(() => {
    if (!active) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    async function requestLock() {
      try {
        if (!("wakeLock" in navigator)) return;
        lock = await navigator.wakeLock.request("screen");
        if (cancelled) {
          await lock.release();
          lock = null;
        }
      } catch {
        // non-fatal
      }
    }
    void requestLock();
    function onVis() {
      if (document.visibilityState === "visible" && wantListenRef.current) void requestLock();
    }
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release();
    };
  }, [active]);

  return {
    listening,
    phase,
    error,
    supported,
    flushNow,
    clearError: () => setError(null),
  };
}
