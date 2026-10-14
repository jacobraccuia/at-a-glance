import { describe, it, expect } from "vitest";
import { speechTextFromReply } from "../src/lib/assistant/tts.js";

describe("speechTextFromReply", () => {
  it("flattens bullets and newlines for speaking", () => {
    const spoken = speechTextFromReply("Added it.\n\n• Added \"Call Gastro\"");
    expect(spoken).toContain("Added it.");
    expect(spoken).toContain('Added "Call Gastro"');
    expect(spoken).not.toContain("•");
    expect(spoken).not.toContain("\n");
  });
});
