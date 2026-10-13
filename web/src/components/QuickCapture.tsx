import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api } from "../api/client";
import { branding } from "../config/branding";
import { ArrowRightIcon, MicIcon } from "./icons";

// Multi-line so a single submission can describe one task or several at
// once (e.g. "call mom, pay rent, and email John") -- the AI-assisted path
// on the server decides how many tasks that actually is; this input just
// needs to get out of the way and feel like talking, not form-filling.
const MAX_ROWS = 8;

// Minimal typing for the Web Speech API. TypeScript's DOM lib covers the
// standard name; Safari/iOS only expose the webkit-prefixed constructor.
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

export function QuickCapture({ onCaptured, addToToday }: { onCaptured: () => void; addToToday?: boolean }) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [speechSupported] = useState(() => Boolean(getSpeechRecognitionCtor()));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Snapshot of the committed (non-interim) text at the moment listening
  // started / last final result landed -- interim results replace everything
  // after this prefix so partial transcripts don't pile up as duplicates.
  const committedPrefixRef = useRef("");

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight || "20");
    const maxHeight = lineHeight * MAX_ROWS;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }

  function applyText(next: string) {
    setText(next);
    // Resize on the next paint so the DOM value is current.
    requestAnimationFrame(() => {
      if (textareaRef.current) autoResize(textareaRef.current);
    });
  }

  async function submit() {
    // Stop listening first so a leftover recognition session doesn't keep
    // dumping speech into the now-empty box after submit.
    stopListening();
    const trimmed = text.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await api.post("/tasks/quick-capture", { text: trimmed, addToToday: addToToday ?? false });
      applyText("");
      onCaptured();
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  // Enter submits (talking-to-it feel); Shift+Enter inserts a real newline
  // for anyone who wants to list tasks one per line on purpose.
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function stopListening() {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.stop();
    } catch {
      // Already stopped -- fine.
    }
    recognitionRef.current = null;
    setListening(false);
  }

  function startListening() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setMicError("Voice input isn't supported in this browser.");
      return;
    }
    setMicError(null);

    // Tear down any previous session first (tap-to-toggle).
    stopListening();

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";

    // Keep whatever the user already typed; new speech appends after it.
    const existing = text.trim();
    committedPrefixRef.current = existing ? `${existing} ` : "";

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
        // Keep a trailing space so the next final/interim chunk reads naturally.
        if (!committedPrefixRef.current.endsWith(" ")) {
          committedPrefixRef.current += " ";
        }
      }
      applyText(`${committedPrefixRef.current}${interim}`.trimStart());
    };

    rec.onerror = (ev) => {
      // "aborted" / "no-speech" are normal end conditions, not user-facing errors.
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        setMicError("Microphone permission denied. Enable it in browser settings.");
      } else if (ev.error === "audio-capture") {
        setMicError("No microphone found.");
      } else if (ev.error !== "aborted" && ev.error !== "no-speech") {
        setMicError(`Voice input error: ${ev.error}`);
      }
      stopListening();
    };

    rec.onend = () => {
      // Browser ended the session (silence timeout, OS interruption). Mirror
      // that in UI; user can tap the mic again to keep talking.
      recognitionRef.current = null;
      setListening(false);
    };

    try {
      rec.start();
      recognitionRef.current = rec;
      setListening(true);
    } catch {
      setMicError("Couldn't start the microphone. Try again.");
      setListening(false);
    }
  }

  function toggleMic() {
    if (listening) stopListening();
    else startListening();
  }

  // Always tear down recognition if the component unmounts mid-listen.
  useEffect(() => () => stopListening(), []);

  return (
    <form onSubmit={onSubmit} className="quick-capture">
      <textarea
        ref={textareaRef}
        rows={1}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          autoResize(e.target);
        }}
        onKeyDown={onKeyDown}
        placeholder={listening ? "Listening..." : "What's up?"}
        disabled={submitting}
        aria-label={`Tell ${branding.assistantName}`}
      />
      <button
        type="button"
        className={`capture-mic${listening ? " listening" : ""}`}
        onClick={toggleMic}
        disabled={submitting || !speechSupported}
        aria-label={listening ? "Stop listening" : "Talk to capture"}
        title={
          !speechSupported
            ? "Voice input isn't supported in this browser"
            : listening
              ? "Stop listening"
              : "Talk to capture"
        }
      >
        <MicIcon />
      </button>
      <button
        type="submit"
        className="capture-submit"
        disabled={submitting || !text.trim()}
        aria-label="Capture task"
        title="Capture (or press Enter)"
      >
        <ArrowRightIcon />
      </button>
      {micError && <p className="capture-mic-error">{micError}</p>}
    </form>
  );
}
