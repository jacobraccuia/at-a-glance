ALTER TABLE "Bucket" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Bucket_one_default_per_user" ON "Bucket" ("userId") WHERE "isDefault";

CREATE TABLE "BucketLesson" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "bucketId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BucketLesson_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BucketLesson_userId_phrase_key" ON "BucketLesson"("userId", "phrase");
CREATE INDEX "BucketLesson_userId_updatedAt_idx" ON "BucketLesson"("userId", "updatedAt");

ALTER TABLE "BucketLesson" ADD CONSTRAINT "BucketLesson_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BucketLesson" ADD CONSTRAINT "BucketLesson_bucketId_fkey" FOREIGN KEY ("bucketId") REFERENCES "Bucket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Bucket" ("id", "userId", "name", "color", "sortOrder", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, u."id", 'Main', '#8A8175', -1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User" u
WHERE NOT EXISTS (
    SELECT 1 FROM "Bucket" b WHERE b."userId" = u."id" AND b."isDefault" = true
);

UPDATE "Task" t
SET "bucketId" = b."id"
FROM "Bucket" b
WHERE t."bucketId" IS NULL
  AND b."userId" = t."userId"
  AND b."isDefault" = true;
