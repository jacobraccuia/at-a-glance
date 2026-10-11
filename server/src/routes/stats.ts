import { Router } from "express";
import { prisma } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getCurrentDateInTimeZone, startOfDayInTimeZone, addDaysToDateString } from "../lib/timezone.js";

export const statsRouter = Router();
statsRouter.use(requireAuth);

statsRouter.get("/", async (req, res) => {
  const userId = req.session.userId!;
  const prefs = await prisma.userPreferences.findUnique({ where: { userId } });
  const tz = prefs?.timezone ?? "UTC";
  const today = getCurrentDateInTimeZone(tz);
  const weekStartStr = addDaysToDateString(today, -6);
  const weekStart = startOfDayInTimeZone(weekStartStr, tz);

  const [completedThisWeek, activeBacklog, byBucket, occurrencesCompletedThisWeek] = await Promise.all([
    prisma.task.count({ where: { userId, status: "completed", completedAt: { gte: weekStart } } }),
    prisma.task.count({ where: { userId, status: "active" } }),
    prisma.task.groupBy({
      by: ["bucketId"],
      where: { userId, status: { not: "dropped" } },
      _count: { _all: true },
    }),
    prisma.taskOccurrence.count({
      where: {
        status: "completed",
        completedAt: { gte: weekStart },
        task: { userId },
      },
    }),
  ]);

  res.json({
    completedThisWeek: completedThisWeek + occurrencesCompletedThisWeek,
    activeBacklog,
    byBucket: byBucket.map((b) => ({ bucketId: b.bucketId, count: b._count._all })),
  });
});
