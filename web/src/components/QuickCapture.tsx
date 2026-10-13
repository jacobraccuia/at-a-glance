import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api } from "../api/client";
import { ArrowRightIcon } from "./icons";

// Fast dump surface on Today -- one or many tasks via text. The real
// conversational assistant (voice + commands like "cancel that task")
// lives on Home (/). Keeping this box intentionally simple.
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
        placeholder="Quick add..."
        disabled={submitting}
        aria-label="Quick add"
      />
      <button
        type="submit"
        className="capture-submit"
        disabled={submitting || !text.trim()}
        aria-label="Add"
        title="Add (or press Enter)"
      >
        <ArrowRightIcon />
      </button>
    </form>
  );
}
