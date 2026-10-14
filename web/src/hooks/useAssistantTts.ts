import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4100/api";

function cleanForSpeech(text: string): string {
  return text
    .replace(/^•\s*/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function speakWithBrowser(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) {
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.05;
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    window.speechSynthesis.speak(utter);
  });
}

/**
 * Speak assistant replies aloud (OpenAI TTS via /assistant/speak, with
 * browser speechSynthesis fallback). Mic should stay muted while `speaking`.
 */
export function useAssistantTts(enabled: boolean) {
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const generationRef = useRef(0);

  const stop = useCallback(() => {
    generationRef.current += 1;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
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
    async (raw: string) => {
      const text = cleanForSpeech(raw);
      if (!text || !enabled) return;
      stop();
      const gen = generationRef.current;
      setSpeaking(true);

      try {
        const res = await fetch(`${API_BASE_URL}/assistant/speak`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });

        if (gen !== generationRef.current) return;

        if (res.ok) {
          const blob = await res.blob();
          if (gen !== generationRef.current) return;
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          const audio = new Audio(url);
          audioRef.current = audio;
          await new Promise<void>((resolve) => {
            audio.onended = () => resolve();
            audio.onerror = () => resolve();
            void audio.play().catch(() => resolve());
          });
        } else {
          // 503 / failure → browser voice so Talk still speaks offline-key.
          await speakWithBrowser(text);
        }
      } catch {
        if (gen === generationRef.current) await speakWithBrowser(text);
      } finally {
        if (gen === generationRef.current) {
          if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = null;
          }
          audioRef.current = null;
          setSpeaking(false);
        }
      }
    },
    [enabled, stop],
  );

  return { speaking, speak, stop };
}
