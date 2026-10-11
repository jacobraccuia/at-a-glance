import "dotenv/config";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = "demo@example.com";
  const passwordHash = await bcrypt.hash("password123", 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      displayName: "Demo User",
      preferences: { create: { timezone: "America/New_York" } },
    },
  });

  const existingBuckets = await prisma.bucket.findMany({ where: { userId: user.id } });
  const personal =
    existingBuckets.find((b) => b.name === "Personal") ??
    (await prisma.bucket.create({ data: { userId: user.id, name: "Personal", color: "#4C9F70", sortOrder: 0 } }));
  const work =
    existingBuckets.find((b) => b.name === "Work") ??
    (await prisma.bucket.create({ data: { userId: user.id, name: "Work", color: "#4062BB", sortOrder: 1 } }));

  const existingTasks = await prisma.task.count({ where: { userId: user.id } });
  if (existingTasks > 0) {
    console.log("Demo user already has tasks, skipping task seed. Login: demo@example.com / password123");
    return;
  }

  await prisma.task.create({
    data: {
      userId: user.id,
      bucketId: personal.id,
      title: "Drop UPS package off",
      status: "active",
      importance: "medium",
    },
  });

  await prisma.task.create({
    data: {
      userId: user.id,
      bucketId: work.id,
      title: "Finish operations table",
      status: "active",
      importance: "high",
      deadlineSource: null,
    },
  });

  const rule = await prisma.recurrenceRule.create({
    data: {
      frequency: "weekly",
      interval: 1,
      byWeekday: [1], // Monday
      startDate: new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z"),
    },
  });

  await prisma.task.create({
    data: {
      userId: user.id,
      bucketId: personal.id,
      title: "Call Mom",
      status: "active",
      importance: "medium",
      recurrenceRuleId: rule.id,
    },
  });

  console.log("Seeded demo user: demo@example.com / password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
