import { describe, expect, it } from "vitest";
import { PERSONALITIES } from "../src/config/personalities.js";
import { freshLiveState, reduceLiveEvent } from "../src/lib/assistant/live/events.js";
import { acceptMemory } from "../src/lib/assistant/live/memory.js";
import { estimateLiveUsd, MONTHLY_BUDGET_USD } from "../src/lib/assistant/live/pricing.js";
import { isHypotheticalTitle, issueDropToken, takeDropToken } from "../src/lib/assistant/live/tools.js";

describe("live pricing", () => {
  it("bills active time, standby time, and luna tokens", () => {
    const usd = estimateLiveUsd({
      seconds: 90,
      activeSeconds: 60,
      pausedSeconds: 30,
      backendInputTokens: 1_000_000,
      backendOutputTokens: 0,
    });
    expect(usd).toBeCloseTo(0.05 + 0.01 + 0.1, 4);
  });

  it("treats unmarked seconds as active", () => {
    const usd = estimateLiveUsd({
      seconds: 60,
      activeSeconds: 0,
      pausedSeconds: 0,
      backendInputTokens: 0,
      backendOutputTokens: 0,
    });
    expect(usd).toBeCloseTo(0.05, 4);
    expect(MONTHLY_BUDGET_USD).toBe(25);
  });
});

describe("live safeguards", () => {
  it("does not treat a someday idea as a task title", () => {
    expect(isHypotheticalTitle("Maybe I should write a book someday")).toBe(true);
    expect(isHypotheticalTitle("Buy milk")).toBe(false);
  });

  it("spends a drop confirmation once", () => {
    const token = issueDropToken("user-1", "task-1");
    expect(takeDropToken("user-1", token)).toBe("task-1");
    expect(takeDropToken("user-1", token)).toBeNull();
    expect(takeDropToken("other", issueDropToken("user-1", "task-2"))).toBeNull();
  });

  it("rejects task status and passing moods as memory", () => {
    expect(acceptMemory({ kind: "preference", text: "I like short answers", source: "stated" })).toBe(true);
    expect(acceptMemory({ kind: "pattern", text: "The dishes task is completed", source: "inferred" })).toBe(false);
    expect(acceptMemory({ kind: "pattern", text: "I am overwhelmed today", source: "inferred" })).toBe(false);
    expect(acceptMemory({ kind: "interest", text: "I want to write a book", source: "stated" })).toBe(true);
  });
});

describe("live events", () => {
  it("flushes the user line when the assistant starts speaking", () => {
    const state = freshLiveState();
    reduceLiveEvent(state, {
      type: "session.input_transcript.delta",
      event_id: "a",
      delta: "Hello there",
    });
    const effects = reduceLiveEvent(state, {
      type: "session.output_transcript.delta",
      event_id: "b",
      delta: "Hi",
    });
    expect(effects).toEqual([{ type: "flush", role: "user", text: "Hello there" }]);
  });

  it("dedupes replayed events and asks the backend to continue after a tool call", () => {
    const state = freshLiveState();
    const call = {
      type: "response.event",
      event_id: "e1",
      delegation_id: "del",
      event: {
        type: "response.output_item.done",
        item: { type: "function_call", call_id: "call_1", name: "list_tasks", arguments: "{\"horizon\":\"today\"}" },
      },
    };
    const first = reduceLiveEvent(state, call);
    const second = reduceLiveEvent(state, call);
    expect(second).toEqual([]);
    expect(first[0]).toMatchObject({ type: "tool", name: "list_tasks", callId: "call_1" });
    const done = reduceLiveEvent(state, {
      type: "response.event",
      event_id: "e2",
      event: { type: "response.completed", response: { id: "resp_1", usage: { input_tokens: 10, output_tokens: 4 } } },
    });
    expect(done.map((effect) => effect.type)).toEqual(["tokens", "continue"]);
  });
});

describe("personalities", () => {
  it("shares one list and keeps Puck and Logos distinct", () => {
    expect(PERSONALITIES.map((personality) => personality.id)).toEqual(["puck", "atlas", "sage", "mercury", "logos"]);
    const puck = PERSONALITIES[0];
    const logos = PERSONALITIES[4];
    expect(puck.humor).not.toBe(logos.humor);
    expect(puck.voice).not.toBe(logos.voice);
  });
});
