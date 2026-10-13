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

/**
 * Push-to-talk / toggle speech recognition. Streams interim text into
 * `onTranscript(fullText)` while listening. Used by the Assistant composer
 * so talking feels like ChatGPT voice, not a dictation accessory on capture.
 */
export function useSpeechRecognition(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported] = useState(() => Boolean(getSpeechRecognitionCtor()));
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const committedPrefixRef = useRef("");
  const baseTextRef = useRef("");
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  function stop() {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.stop();
    } catch {
      // already stopped
    }
    recognitionRef.current = null;
    setListening(false);
  }

  function start(existingText = "") {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("Voice isn't supported in this browser.");
      return;
    }
    setError(null);
    stop();

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";

    baseTextRef.current = existingText.trim();
    committedPrefixRef.current = baseTextRef.current ? `${baseTextRef.current} ` : "";

    rec.onresult = (ev) => {
      let interim = "";
      let finals = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const chunk = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finals += chunk;
        else interim += chunk;
      }
      if (finals) {
        committedPrefixRef.current = `${committedPrefixRef.current}${finals}`.replace(/\s+/g, " ");
        if (!committedPrefixRef.current.endsWith(" ")) committedPrefixRef.current += " ";
      }
      onTranscriptRef.current(`${committedPrefixRef.current}${interim}`.trimStart());
    };

    rec.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        setError("Microphone permission denied.");
      } else if (ev.error === "audio-capture") {
        setError("No microphone found.");
      } else if (ev.error !== "aborted" && ev.error !== "no-speech") {
        setError(`Voice error: ${ev.error}`);
      }
      stop();
    };

    rec.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };

    try {
      rec.start();
      recognitionRef.current = rec;
      setListening(true);
    } catch {
      setError("Couldn't start the microphone.");
      setListening(false);
    }
  }

  function toggle(existingText = "") {
    if (listening) stop();
    else start(existingText);
  }

  useEffect(() => () => stop(), []);

  return { listening, error, supported, start, stop, toggle, clearError: () => setError(null) };
}
