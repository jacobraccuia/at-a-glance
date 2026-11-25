// Pure reducer for GPT-Live sideband events. The socket layer performs the effects.
export interface LiveUsageSnapshot {
  seconds: number;
  activeSeconds: number;
  pausedSeconds: number;
}

export interface ToolCallEffect {
  type: "tool";
  delegationId: string | null;
  callId: string;
  name: string;
  arguments: string;
}

export type LiveEffect =
  | { type: "flush"; role: "user" | "assistant"; text: string }
  | ToolCallEffect
  | { type: "continue" }
  | { type: "usage"; usage: LiveUsageSnapshot }
  | { type: "closed"; usage?: LiveUsageSnapshot }
  | { type: "paused" }
  | { type: "resumed" }
  | { type: "tokens"; input: number; output: number; responseId: string };

export interface LiveReduceState {
  seen: Set<string>;
  user: string;
  assistant: string;
  speaker: "user" | "assistant" | null;
  needsContinue: boolean;
  countedResponses: Set<string>;
}

export function freshLiveState(): LiveReduceState {
  return {
    seen: new Set(),
    user: "",
    assistant: "",
    speaker: null,
    needsContinue: false,
    countedResponses: new Set(),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function usageFrom(value: unknown): LiveUsageSnapshot | undefined {
  const row = asRecord(value);
  if (!row || typeof row.seconds !== "number") return undefined;
  return {
    seconds: row.seconds,
    activeSeconds: typeof row.active_seconds === "number" ? row.active_seconds : 0,
    pausedSeconds: typeof row.paused_seconds === "number" ? row.paused_seconds : 0,
  };
}

function tokenPair(value: unknown): { input: number; output: number } | null {
  const row = asRecord(value);
  if (!row) return null;
  const input = typeof row.input_tokens === "number" ? row.input_tokens : 0;
  const output = typeof row.output_tokens === "number" ? row.output_tokens : 0;
  if (input === 0 && output === 0) return null;
  return { input, output };
}

export function reduceLiveEvent(state: LiveReduceState, event: unknown): LiveEffect[] {
  const row = asRecord(event);
  if (!row || typeof row.type !== "string") return [];
  const eventId = typeof row.event_id === "string" ? row.event_id : "";
  if (eventId) {
    if (state.seen.has(eventId)) return [];
    state.seen.add(eventId);
  }

  const effects: LiveEffect[] = [];
  const type = row.type;

  if (type === "session.input_transcript.delta" || type === "session.output_transcript.delta") {
    const delta = typeof row.delta === "string" ? row.delta : "";
    const role = type === "session.input_transcript.delta" ? "user" : "assistant";
    if (state.speaker && state.speaker !== role) {
      const text = (state.speaker === "user" ? state.user : state.assistant).trim();
      if (text) effects.push({ type: "flush", role: state.speaker, text });
      if (state.speaker === "user") state.user = "";
      else state.assistant = "";
    }
    state.speaker = role;
    if (role === "user") state.user += delta;
    else state.assistant += delta;
    return effects;
  }

  if (type === "session.usage.updated") {
    const usage = usageFrom(row.usage);
    if (usage) effects.push({ type: "usage", usage });
    return effects;
  }

  if (type === "session.paused") {
    effects.push({ type: "paused" });
    return effects;
  }
  if (type === "session.resumed") {
    effects.push({ type: "resumed" });
    return effects;
  }

  if (type === "session.closed") {
    const textUser = state.user.trim();
    const textAssistant = state.assistant.trim();
    if (state.speaker === "user" && textUser) effects.push({ type: "flush", role: "user", text: textUser });
    if (state.speaker === "assistant" && textAssistant) effects.push({ type: "flush", role: "assistant", text: textAssistant });
    if (state.speaker !== "user" && textUser) effects.push({ type: "flush", role: "user", text: textUser });
    if (state.speaker !== "assistant" && textAssistant) effects.push({ type: "flush", role: "assistant", text: textAssistant });
    state.user = "";
    state.assistant = "";
    state.speaker = null;
    effects.push({ type: "closed", usage: usageFrom(row.usage) });
    return effects;
  }

  if (type !== "response.event") return effects;
  const inner = asRecord(row.event);
  if (!inner || typeof inner.type !== "string") return effects;
  const delegationId = typeof row.delegation_id === "string" ? row.delegation_id : null;

  if (inner.type === "response.output_item.done") {
    const item = asRecord(inner.item);
    if (item?.type === "function_call" && typeof item.call_id === "string" && typeof item.name === "string") {
      const args =
        typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {});
      state.needsContinue = true;
      effects.push({
        type: "tool",
        delegationId,
        callId: item.call_id,
        name: item.name,
        arguments: args,
      });
    }
    return effects;
  }

  if (inner.type === "response.completed" || inner.type === "response.done") {
    const response = asRecord(inner.response);
    const responseId = typeof response?.id === "string" ? response.id : eventId || `resp-${state.countedResponses.size}`;
    const tokens = tokenPair(response?.usage);
    if (tokens && !state.countedResponses.has(responseId)) {
      state.countedResponses.add(responseId);
      effects.push({ type: "tokens", ...tokens, responseId });
    }
    if (state.needsContinue) {
      state.needsContinue = false;
      effects.push({ type: "continue" });
    }
  }

  return effects;
}

export function flushRemainder(state: LiveReduceState): LiveEffect[] {
  const effects: LiveEffect[] = [];
  const user = state.user.trim();
  const assistant = state.assistant.trim();
  if (user) effects.push({ type: "flush", role: "user", text: user });
  if (assistant) effects.push({ type: "flush", role: "assistant", text: assistant });
  state.user = "";
  state.assistant = "";
  state.speaker = null;
  return effects;
}
