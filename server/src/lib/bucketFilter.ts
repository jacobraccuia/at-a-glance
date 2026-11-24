import type { PrismaClient } from "@prisma/client";

/** Bucket ids whose name matches exactly, case-insensitive. Empty when the name is blank. */
export async function bucketIdsByName(prisma: PrismaClient, userId: string, name: string | undefined): Promise<string[]> {
  const wanted = name?.trim().toLowerCase();
  if (!wanted) return [];
  const buckets = await prisma.bucket.findMany({
    where: { userId, archivedAt: null },
    select: { id: true, name: true },
  });
  return buckets.filter((b) => b.name.trim().toLowerCase() === wanted).map((b) => b.id);
}
