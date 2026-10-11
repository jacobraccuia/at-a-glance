import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const goalsRouter = Router();
goalsRouter.use(requireAuth);

goalsRouter.get("/", async (req, res) => {
  const userId = req.session.userId!;
  const goals = await prisma.goal.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  res.json(goals);
});

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

goalsRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const userId = req.session.userId!;
  const goal = await prisma.goal.create({ data: { userId, ...parsed.data } });
  res.status(201).json(goal);
});

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(["active", "completed", "archived"]).optional(),
});

goalsRouter.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const userId = req.session.userId!;
  const goal = await prisma.goal.findFirst({ where: { id: req.params.id, userId } });
  if (!goal) return res.status(404).json({ error: "Goal not found" });
  const updated = await prisma.goal.update({ where: { id: goal.id }, data: parsed.data });
  res.json(updated);
});
