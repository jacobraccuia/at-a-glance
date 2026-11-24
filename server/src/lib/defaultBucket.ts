import { prisma } from "../db/client.js";

export const DEFAULT_BUCKET_NAME = "Main";
const DEFAULT_BUCKET_COLOR = "#8A8175";

/** The home bucket. Created once per user. Rename later; do not archive. */
export async function ensureDefaultBucket(userId: string) {
  const existing = await prisma.bucket.findFirst({ where: { userId, isDefault: true } });
  if (existing) return existing;
  return prisma.bucket.create({
    data: {
      userId,
      name: DEFAULT_BUCKET_NAME,
      color: DEFAULT_BUCKET_COLOR,
      sortOrder: -1,
      isDefault: true,
    },
  });
}
