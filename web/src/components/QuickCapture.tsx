import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api } from "../api/client";
import { branding } from "../config/branding";
import { ArrowRightIcon } from "./icons";

// Multi-line so a single submission can describe one task or several at
// once (e.g. "call mom, pay rent, and email John") -- the AI-assisted path
// on the server decides how many tasks that actually is; this input just
// needs to get out of the way and feel like talking, not form-filling.
const MAX_ROWS = 8;

export function QuickCapture({ onCaptured, addToToday }: { onCaptured: () => void; addToToday?: boolean }) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight || "20");
    const maxHeight = lineHeight * MAX_ROWS;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await api.post("/tasks/quick-capture", { text: trimmed, addToToday: addToToday ?? false });
      setText("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
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
        placeholder={`Tell ${branding.assistantName}... one thing, or dump several at once (Shift+Enter for a new line)`}
        disabled={submitting}
      />
      <button
        type="submit"
        className="capture-submit"
        disabled={submitting || !text.trim()}
        aria-label="Capture task"
        title="Capture (or press Enter)"
      >
        <ArrowRightIcon />
      </button>
    </form>
  );
}
