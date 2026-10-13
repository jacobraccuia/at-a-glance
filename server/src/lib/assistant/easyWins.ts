// Rules-based Easy Wins ranking (master prompt: transparent baseline,
// not an opaque AI score). "Quickly actionable" = fits a time budget,
// not blocked, not snoozed, short enough to finish in one sitting.
import type { Task } from "@prisma/client";

export interface EasyWin {
  id: string;
  title: string;
  estimateMinutes: number | null;
  importance: string;
  status: string;
  score: number;
  /** Assumed minutes used for ranking when the task has no estimate. */
  assumedMinutes: number;
}

export const DEFAULT_EASY_WIN_MINUTES = 25;
/** Cold-start assumption when estimateMinutes is null -- conservative short. */
const UNKNOWN_ESTIMATE_ASSUMPTION = 15;

/**
 * Rank open tasks that can realistically be finished inside `budgetMinutes`.
 * Pure function -- no DB, no LLM.
 */
export function rankEasyWins(tasks: Task[], budgetMinutes: number = DEFAULT_EASY_WIN_MINUTES): EasyWin[] {
  const now = Date.now();
  const budget = Math.max(1, Math.min(240, budgetMinutes));

  const scored: EasyWin[] = [];
  for (const t of tasks) {
    if (t.status !== "active" && t.status !== "captured") continue;
    if (t.snoozedUntil && t.snoozedUntil.getTime() > now) continue;
    // Waiting on someone else is the opposite of an easy win.
    if (t.waitingOn && t.waitingOn.trim()) continue;

    const assumedMinutes = t.estimateMinutes ?? UNKNOWN_ESTIMATE_ASSUMPTION;
    if (assumedMinutes > budget) continue;

    // Shorter = higher score. Unknown estimates get a small confidence penalty.
    let score = 100 - assumedMinutes;
    if (t.estimateMinutes == null) score -= 10;
    // Low-friction items nudge up; high-importance + tiny effort is a jackpot.
    if (t.importance === "low") score += 5;
    if (t.importance === "high" && assumedMinutes <= 10) score += 10;
    // Weak neglect factor -- older open tasks get a gentle bump (capped).
    const ageDays = (now - t.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    score += Math.min(ageDays, 14) * 0.5;
    // Already on today's radar is slightly preferred.
    if (t.attentionDate) score += 3;

    scored.push({
      id: t.id,
      title: t.title,
      estimateMinutes: t.estimateMinutes,
      importance: t.importance,
      status: t.status,
      score,
      assumedMinutes,
    });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, 8);
}

export function formatEasyWinsSummary(wins: EasyWin[], budgetMinutes: number): string {
  if (wins.length === 0) {
    return `No easy wins that fit in ${budgetMinutes} minutes right now.`;
  }
  const lines = wins.map((w) => {
    const mins = w.estimateMinutes != null ? `~${w.estimateMinutes}m` : `~${w.assumedMinutes}m?`;
    return `• "${w.title}" (${mins})`;
  });
  return `Easy wins for ~${budgetMinutes} minutes:\n${lines.join("\n")}`;
}
