import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { prisma } from "../db/client.js";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(100),
  timezone: z.string().min(1).max(100).default("UTC"),
});

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password, displayName, timezone } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "Email already registered" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName,
      preferences: { create: { timezone } },
    },
  });

  req.session.userId = user.id;
  return res.status(201).json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
  });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  req.session.userId = user.id;
  return res.json({ id: user.id, email: user.email, displayName: user.displayName });
});

authRouter.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.status(204).send();
  });
});

authRouter.get("/me", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  const user = await prisma.user.findUnique({
    where: { id: req.session.userId },
    include: { preferences: true },
  });
  if (!user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  return res.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    timezone: user.preferences?.timezone ?? "UTC",
  });
});
