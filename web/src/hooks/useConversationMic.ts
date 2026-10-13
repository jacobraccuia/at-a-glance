import { useEffect, useRef, useState } from "react";

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
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

const DEFAULT_SILENCE_MS = 1400;

export interface ConversationMicOptions {
  /** When true, keep the mic session alive and listen for turns. */
  active: boolean;
  /** Pause after speech settles; then fire once per utterance. */
  silenceMs?: number;
  onUtterance: (text: string) => void;
  onPartial?: (text: string) => void;
  onActivity?: () => void;
}

/**
 * Conversation-style mic: listen → pause = end of turn → callback.
 * Tries to restart after browser `onend` and after returning from background
 * (web browsers often still kill the mic when backgrounded — we re-open on focus).
 */
export function useConversationMic(opts: ConversationMicOptions) {
  const { active, silenceMs = DEFAULT_SILENCE_MS, onUtterance, onPartial, onActivity } = opts;
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported] = useState(() => Boolean(getSpeechRecognitionCtor()));

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wantListenRef = useRef(false);
  const finalsRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emittingRef = useRef(false);

  const onUtteranceRef = useRef(onUtterance);
  const onPartialRef = useRef(onPartial);
  const onActivityRef = useRef(onActivity);
  onUtteranceRef.current = onUtterance;
  onPartialRef.current = onPartial;
  onActivityRef.current = onActivity;

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

  function emitUtterance() {
    const text = finalsRef.current.trim();
    clearSilence();
    if (!text || emittingRef.current) return;
    emittingRef.current = true;
    finalsRef.current = "";
    onPartialRef.current?.("");
    onUtteranceRef.current(text);
    // Parent sets active=false while sending; unlock on next listen cycle.
    setTimeout(() => {
      emittingRef.current = false;
    }, 0);
  }

  function scheduleSilenceFlush() {
    clearSilence();
    silenceTimerRef.current = setTimeout(() => {
      emitUtterance();
    }, silenceMs);
  }

  function hardStop() {
    clearSilence();
    clearRestart();
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      try {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.stop();
      } catch {
        // already stopped
      }
    }
    setListening(false);
  }

  function startRecognition() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor || !wantListenRef.current) return;
    if (recognitionRef.current) return;

    setError(null);
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";

    rec.onresult = (ev) => {
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
      onPartialRef.current?.(shown);
      if (gotFinal || interim) scheduleSilenceFlush();
    };

    rec.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        setError("Microphone permission denied.");
        wantListenRef.current = false;
        hardStop();
        return;
      }
      if (ev.error === "audio-capture") {
        setError("No microphone found.");
        wantListenRef.current = false;
        hardStop();
        return;
      }
      // no-speech / aborted: let onend restart if we still want listen
      if (ev.error !== "aborted" && ev.error !== "no-speech") {
        setError(`Voice error: ${ev.error}`);
      }
    };

    rec.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      if (!wantListenRef.current) return;
      // Browsers end the session often; restart if the sheet still wants listen.
      clearRestart();
      restartTimerRef.current = setTimeout(() => {
        if (wantListenRef.current) startRecognition();
      }, 180);
    };

    try {
      rec.start();
      recognitionRef.current = rec;
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setListening(false);
      clearRestart();
      restartTimerRef.current = setTimeout(() => {
        if (wantListenRef.current) startRecognition();
      }, 400);
    }
  }

  // Drive listen from `active`.
  useEffect(() => {
    wantListenRef.current = active;
    if (active) {
      finalsRef.current = "";
      emittingRef.current = false;
      startRecognition();
    } else {
      hardStop();
      finalsRef.current = "";
      onPartialRef.current?.("");
    }
    return () => {
      wantListenRef.current = false;
      hardStop();
    };
    // intentionally only react to active — callbacks via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Re-open mic when returning from background if session still active.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "visible" && wantListenRef.current) {
        onActivityRef.current?.();
        if (!recognitionRef.current) startRecognition();
      }
      // When hidden: do NOT call stop — keep recognition alive as long as the
      // browser allows (ChatGPT-like). Many mobile browsers still suspend it;
      // the visible handler above recovers.
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the screen awake while listening so mobile doesn't sleep mid-convo.
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
        // unsupported / denied — non-fatal
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
    error,
    supported,
    clearError: () => setError(null),
  };
}
