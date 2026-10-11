import type { Prisma, TaskEventType } from "@prisma/client";
import { prisma } from "../db/client.js";

export async function logTaskEvent(
  tx: Prisma.TransactionClient | typeof prisma,
  params: { taskId: string; userId: string; type: TaskEventType; payload?: Record<string, unknown> }
) {
  await tx.taskEvent.create({
    data: {
      taskId: params.taskId,
      userId: params.userId,
      type: params.type,
      payload: (params.payload ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
