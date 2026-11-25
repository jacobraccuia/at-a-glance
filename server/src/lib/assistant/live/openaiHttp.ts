const RESPONSES_URL = "https://api.openai.com/v1/responses";

export interface ResponseCall {
  callId: string;
  name: string;
  arguments: string;
}

export interface ResponsesResult {
  id: string;
  outputText: string;
  calls: ResponseCall[];
  inputTokens: number;
  outputTokens: number;
}

function apiKey(): string | null {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key ? key : null;
}

export function liveKey(): string | null {
  return apiKey();
}

export async function createResponse(body: Record<string, unknown>): Promise<ResponsesResult | null> {
  const key = apiKey();
  if (!key) return null;
  const res = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`responses ${res.status} ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    id?: string;
    output?: Array<Record<string, unknown>>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const calls: ResponseCall[] = [];
  const texts: string[] = [];
  for (const item of json.output ?? []) {
    if (item.type === "function_call" && typeof item.call_id === "string" && typeof item.name === "string") {
      calls.push({
        callId: item.call_id,
        name: item.name,
        arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {}),
      });
    }
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content as Array<Record<string, unknown>>) {
        if (typeof part.text === "string") texts.push(part.text);
      }
    }
  }
  return {
    id: json.id ?? "",
    outputText: texts.join("\n").trim(),
    calls,
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
  };
}
