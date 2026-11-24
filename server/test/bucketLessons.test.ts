import { describe, expect, it } from "vitest";
import { matchLesson, phraseFromTitle } from "../src/lib/assistant/bucketLessons.js";

describe("bucket lessons", () => {
  it("keeps the words that identify a task", () => {
    expect(phraseFromTitle("Water the plants")).toBe("water plants");
  });

  it("uses the longest remembered phrase that fits", () => {
    const lessons = [
      { phrase: "plants", bucketName: "Personal" },
      { phrase: "office plants", bucketName: "Work" },
    ];
    expect(matchLesson("Water the office plants", lessons)).toBe("Work");
    expect(matchLesson("Water the plants", lessons)).toBe("Personal");
  });

  it("returns null when nothing was learned", () => {
    expect(matchLesson("Call the dentist", [{ phrase: "plants", bucketName: "Personal" }])).toBeNull();
  });
});
