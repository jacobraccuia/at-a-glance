import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api } from "../api/client";
import { ArrowRightIcon } from "./icons";

// Fast dump. No date lands in Later. A named day lands in that horizon.
const MAX_ROWS = 8;

const PLACE: Record<string, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  nextWeek: "Next week",
  later: "Later",
};

export function QuickCapture({ onCaptured }: { onCaptured: () => void }) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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
      const created = await api.post<{ title: string; horizon?: string }[]>("/tasks/quick-capture", { text: trimmed });
      setText("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      setNotice(savedNote(created));
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
        placeholder="Add a task..."
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
      {notice && <p className="capture-note">{notice}</p>}
    </form>
  );
}

function savedNote(tasks: { horizon?: string }[]): string {
  const places = [...new Set(tasks.map((t) => PLACE[t.horizon ?? "later"] ?? "Later"))];
  if (tasks.length === 1) return `Saved to ${places[0]}.`;
  if (places.length === 1) return `Saved ${tasks.length} to ${places[0]}.`;
  return `Saved ${tasks.length}. Each one landed in its own time.`;
}
