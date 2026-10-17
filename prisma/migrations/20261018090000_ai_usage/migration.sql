-- AI spending per day and task, for the daily AI budget (FEATURE G5).
CREATE TABLE "ai_usage" (
    "day" DATE NOT NULL,
    "task" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" BIGINT NOT NULL DEFAULT 0,
    "output_tokens" BIGINT NOT NULL DEFAULT 0,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("day","task")
);
