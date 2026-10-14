import OpenAI from "openai";

const MAX_CHARS = 900;

function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

/** Flatten assistant reply text into something natural to speak aloud. */
export function speechTextFromReply(raw: string): string {
  return raw
    .replace(/^•\s*/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CHARS);
}

/**
 * OpenAI TTS → mp3 bytes. Returns null when no API key (caller may fall back
 * to browser speechSynthesis).
 */
export async function synthesizeSpeech(text: string): Promise<Buffer | null> {
  const client = getClient();
  if (!client) return null;
  const input = speechTextFromReply(text);
  if (!input) return null;

  const response = await client.audio.speech.create({
    model: "tts-1",
    voice: "nova",
    input,
    response_format: "mp3",
  });
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
