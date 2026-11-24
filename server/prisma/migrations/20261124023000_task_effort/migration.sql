CREATE TYPE "Effort" AS ENUM ('low', 'medium', 'high');

ALTER TABLE "Task" ADD COLUMN "effort" "Effort";
