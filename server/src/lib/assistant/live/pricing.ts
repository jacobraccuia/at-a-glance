// Rates from the OpenAI pricing page, 2026-11-24.
// gpt-live-1.1: $0.05 active minute, $0.02 standby minute, billed per second.
// gpt-6-luna short context: $0.10 / 1M input, $0.50 / 1M output.
export const ACTIVE_USD_PER_SECOND = 0.05 / 60;
export const STANDBY_USD_PER_SECOND = 0.02 / 60;
export const LUNA_INPUT_USD_PER_TOKEN = 0.1 / 1_000_000;
export const LUNA_OUTPUT_USD_PER_TOKEN = 0.5 / 1_000_000;
export const MONTHLY_BUDGET_USD = 25;

export interface UsageSlice {
  seconds: number;
  activeSeconds: number;
  pausedSeconds: number;
  backendInputTokens: number;
  backendOutputTokens: number;
}

export function estimateLiveUsd(usage: UsageSlice): number {
  const active = Math.max(0, usage.activeSeconds);
  const paused = Math.max(0, usage.pausedSeconds);
  const leftover = Math.max(0, usage.seconds - active - paused);
  const voice = active * ACTIVE_USD_PER_SECOND + paused * STANDBY_USD_PER_SECOND + leftover * ACTIVE_USD_PER_SECOND;
  const backend =
    Math.max(0, usage.backendInputTokens) * LUNA_INPUT_USD_PER_TOKEN +
    Math.max(0, usage.backendOutputTokens) * LUNA_OUTPUT_USD_PER_TOKEN;
  return Math.round((voice + backend) * 10_000) / 10_000;
}
