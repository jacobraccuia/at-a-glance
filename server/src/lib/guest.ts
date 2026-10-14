import { randomBytes, randomUUID } from "crypto";
import bcrypt from "bcrypt";
import { prisma } from "../db/client.js";

export const GUEST_EMAIL_DOMAIN = "guest.taskr.local";

export function isGuestEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${GUEST_EMAIL_DOMAIN}`);
}

export function publicUser(user: { id: string; email: string; displayName: string }, timezone: string) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    timezone,
    isGuest: isGuestEmail(user.email),
  };
}

/** Create a fresh throwaway account with a few sample tasks for phone testing. */
export async function createGuestUser(timezone: string) {
  const email = `guest-${randomUUID()}@${GUEST_EMAIL_DOMAIN}`;
  const passwordHash = await bcrypt.hash(randomBytes(24).toString("hex"), 10);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName: "Guest",
      preferences: { create: { timezone: timezone || "UTC" } },
    },
  });

  const personal = await prisma.bucket.create({
    data: { userId: user.id, name: "Personal", color: "#4C9F70", sortOrder: 0 },
  });
  const work = await prisma.bucket.create({
    data: { userId: user.id, name: "Work", color: "#4062BB", sortOrder: 1 },
  });

  const today = new Date();
  await prisma.task.createMany({
    data: [
      {
        userId: user.id,
        bucketId: personal.id,
        title: "Water the plants",
        status: "active",
        importance: "low",
        estimateMinutes: 5,
        attentionDate: today,
        origin: "manual",
      },
      {
        userId: user.id,
        bucketId: work.id,
        title: "Reply to the promoter",
        status: "active",
        importance: "high",
        estimateMinutes: 10,
        attentionDate: today,
        origin: "manual",
      },
      {
        userId: user.id,
        bucketId: personal.id,
        title: "Drop UPS package off",
        status: "active",
        importance: "medium",
        estimateMinutes: 15,
        origin: "manual",
      },
      {
        userId: user.id,
        bucketId: work.id,
        title: "Plan the drop party",
        status: "captured",
        importance: "medium",
        estimateMinutes: 45,
        origin: "manual",
      },
    ],
  });

  return user;
}
