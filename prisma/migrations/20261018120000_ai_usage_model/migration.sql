-- AI usage per model too (D157: each task has its own model).
ALTER TABLE "ai_usage" ADD COLUMN "model" TEXT NOT NULL DEFAULT 'gemini-3.8-flash';
ALTER TABLE "ai_usage" ALTER COLUMN "model" DROP DEFAULT;
ALTER TABLE "ai_usage" DROP CONSTRAINT "ai_usage_pkey";
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("day", "task", "model");
