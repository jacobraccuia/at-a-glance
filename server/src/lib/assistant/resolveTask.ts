import type { Task } from "@prisma/client";

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Resolve a free-text task reference against a candidate list.
 * Returns the single best match, or null if zero / ambiguous.
 */
export function resolveTaskQuery(query: string, candidates: Task[]): Task | null {
  const q = normalize(query);
  if (!q) return null;

  const scored = candidates
    .map((t) => {
      const title = normalize(t.title);
      let score = 0;
      if (title === q) score = 100;
      else if (title.includes(q)) score = 80;
      else if (q.includes(title) && title.length >= 4) score = 70;
      else {
        const qTokens = q.split(" ").filter((tok) => tok.length > 2);
        if (qTokens.length === 0) return { t, score: 0 };
        const hits = qTokens.filter((tok) => title.includes(tok)).length;
        score = (hits / qTokens.length) * 60;
      }
      return { t, score };
    })
    .filter((x) => x.score >= 40)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  if (scored.length >= 2 && scored[0].score - scored[1].score < 15 && scored[1].score >= 50) {
    return null;
  }
  return scored[0].t;
}
