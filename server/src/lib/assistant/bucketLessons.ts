import { prisma } from "../../db/client.js";

const STOP = new Set(["a", "an", "the", "to", "for", "and", "or", "of", "my", "on", "in", "at", "it"]);

export interface BucketLessonHint {
  phrase: string;
  bucketName: string;
}

/** Words worth remembering. Empty when the title is only filler. */
export function phraseFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP.has(word))
    .join(" ")
    .slice(0, 80);
}

export function formatLessonPrompt(lessons: BucketLessonHint[]): string {
  if (lessons.length === 0) return "";
  const lines = lessons.slice(0, 20).map((lesson) => `- "${lesson.phrase}" → ${lesson.bucketName}`);
  return (
    "The user has placed similar tasks by hand. When a new task is about the same thing, use that bucket:\n" +
    lines.join("\n")
  );
}

/** Longest remembered phrase whose words all show up in the new title. */
export function matchLesson(title: string, lessons: BucketLessonHint[]): string | null {
  const phrase = phraseFromTitle(title);
  if (!phrase) return null;
  const words = new Set(phrase.split(" "));
  const ranked = [...lessons].sort((a, b) => b.phrase.split(" ").length - a.phrase.split(" ").length);
  for (const lesson of ranked) {
    const lessonWords = lesson.phrase.split(" ").filter(Boolean);
    if (lessonWords.length === 0) continue;
    if (lessonWords.every((word) => words.has(word))) return lesson.bucketName;
  }
  return null;
}

export async function listBucketLessons(userId: string): Promise<BucketLessonHint[]> {
  const rows = await prisma.bucketLesson.findMany({
    where: { userId, bucket: { archivedAt: null } },
    orderBy: { updatedAt: "desc" },
    take: 30,
    include: { bucket: true },
  });
  return rows.map((row) => ({ phrase: row.phrase, bucketName: row.bucket.name }));
}

export async function rememberBucketChoice(userId: string, title: string, bucketId: string): Promise<void> {
  const phrase = phraseFromTitle(title);
  if (!phrase) return;
  await prisma.bucketLesson.upsert({
    where: { userId_phrase: { userId, phrase } },
    create: { userId, phrase, bucketId },
    update: { bucketId },
  });
}
