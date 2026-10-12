import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import { branding } from "../config/branding";

export function QuickCapture({ onCaptured, addToToday }: { onCaptured: () => void; addToToday?: boolean }) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      await api.post("/tasks/quick-capture", { text: text.trim(), addToToday: addToToday ?? false });
      setText("");
      onCaptured();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="quick-capture">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`Tell ${branding.assistantName}... (e.g. "Drop the package off this week")`}
        disabled={submitting}
      />
      <button type="submit" disabled={submitting || !text.trim()}>
        Capture
      </button>
    </form>
  );
}
