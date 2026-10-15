import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../api/client";

/** 1-sample silent wav. Played on the Talk tap so later speech is allowed. */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

let sharedAudio: HTMLAudioElement | null = null;

function audioEl(): HTMLAudioElement {
  if (!sharedAudio) sharedAudio = new Audio();
  return sharedAudio;
}

/** Call from the Talk button click so iOS will play the reply later. */
export function primeTalkAudio() {
  if (typeof window === "undefined") return;
  const audio = audioEl();
  audio.src = SILENT_WAV;
  void audio.play().then(() => audio.pause()).catch(() => undefined);
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.resume();
  const unlock = new SpeechSynthesisUtterance("\u200b");
  unlock.volume = 0;
  unlock.rate = 2;
  window.speechSynthesis.speak(unlock);
}

function cleanForSpeech(text: string): string {
  return text
    .replace(/^•\s*/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function speakWithBrowser(text: string, onStart?: (durationMs: number | null) => void): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) {
      onStart?.(null);
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.05;
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      onStart?.(Math.max(900, text.length * 62));
    };
    utter.onstart = start;
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    window.speechSynthesis.speak(utter);
    window.setTimeout(start, 280);
  });
}

export type SpeakHooks = {
  /** Fires when audio actually starts, with length if we know it. */
  onStart?: (durationMs: number | null) => void;
};

/**
 * Speak assistant replies aloud (OpenAI TTS via /assistant/speak, with
 * browser speechSynthesis fallback). Mic should stay muted while `speaking`.
 */
export function useAssistantTts(enabled: boolean) {
  const [speaking, setSpeaking] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  const generationRef = useRef(0);

  const stop = useCallback(() => {
    generationRef.current += 1;
    const audio = sharedAudio;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      try {
        audio.load();
      } catch {
        /* ignore */
      }
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  useEffect(() => () => stop(), [stop]);

  const speak = useCallback(
    async (raw: string, hooks?: SpeakHooks) => {
      const text = cleanForSpeech(raw);
      if (!text || !enabled) return;
      stop();
      const gen = generationRef.current;
      setSpeaking(true);
      let started = false;
      const onStart = (durationMs: number | null) => {
        if (started || gen !== generationRef.current) return;
        started = true;
        hooks?.onStart?.(durationMs);
      };

      try {
        const res = await fetch(`${API_BASE_URL}/assistant/speak`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (gen !== generationRef.current) return;

        if (!res.ok) {
          await speakWithBrowser(text, onStart);
          return;
        }

        const blob = await res.blob();
        if (gen !== generationRef.current) return;
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        const audio = audioEl();
        audio.src = url;

        try {
          await new Promise<void>((resolve, reject) => {
            audio.onended = () => resolve();
            audio.onpause = () => {
              if (gen !== generationRef.current) resolve();
            };
            audio.onerror = () => reject(new Error("audio"));
            const mark = () => {
              const ms = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : null;
              onStart(ms);
            };
            audio.onplaying = mark;
            void audio.play().then(mark).catch(reject);
          });
        } catch {
          if (gen === generationRef.current) await speakWithBrowser(text, onStart);
        }
      } catch {
        if (gen === generationRef.current) await speakWithBrowser(text, onStart);
      } finally {
        if (!started && gen === generationRef.current) onStart(null);
        if (gen === generationRef.current) {
          if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = null;
          }
          setSpeaking(false);
        }
      }
    },
    [enabled, stop],
  );

  return { speaking, speak, stop };
}
