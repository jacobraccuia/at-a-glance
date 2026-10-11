import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const bucketsRouter = Router();
bucketsRouter.use(requireAuth);

bucketsRouter.get("/", async (req, res) => {
  const includeArchived = req.query.includeArchived === "true";
  const buckets = await prisma.bucket.findMany({
    where: {
      userId: req.session.userId!,
      ...(includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: { sortOrder: "asc" },
  });
  res.json(buckets);
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().max(20).optional(),
  icon: z.string().max(50).optional(),
});

bucketsRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const userId = req.session.userId!;

  const existing = await prisma.bucket.findFirst({
    where: { userId, name: parsed.data.name, archivedAt: null },
  });
  if (existing) {
    return res.status(409).json({ error: "A bucket with this name already exists" });
  }

  const maxSort = await prisma.bucket.aggregate({
    where: { userId },
    _max: { sortOrder: true },
  });

  const bucket = await prisma.bucket.create({
    data: {
      userId,
      name: parsed.data.name,
      color: parsed.data.color,
      icon: parsed.data.icon,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
  });
  res.status(201).json(bucket);
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().max(20).nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

bucketsRouter.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const userId = req.session.userId!;
  const bucket = await prisma.bucket.findFirst({ where: { id: req.params.id, userId } });
  if (!bucket) {
    return res.status(404).json({ error: "Bucket not found" });
  }
  const updated = await prisma.bucket.update({
    where: { id: bucket.id },
    data: parsed.data,
  });
  res.json(updated);
});

bucketsRouter.post("/:id/archive", async (req, res) => {
  const userId = req.session.userId!;
  const bucket = await prisma.bucket.findFirst({ where: { id: req.params.id, userId } });
  if (!bucket) {
    return res.status(404).json({ error: "Bucket not found" });
  }
  const updated = await prisma.bucket.update({
    where: { id: bucket.id },
    data: { archivedAt: new Date() },
  });
  res.json(updated);
});

bucketsRouter.post("/:id/unarchive", async (req, res) => {
  const userId = req.session.userId!;
  const bucket = await prisma.bucket.findFirst({ where: { id: req.params.id, userId } });
  if (!bucket) {
    return res.status(404).json({ error: "Bucket not found" });
  }
  const updated = await prisma.bucket.update({
    where: { id: bucket.id },
    data: { archivedAt: null },
  });
  res.json(updated);
});
