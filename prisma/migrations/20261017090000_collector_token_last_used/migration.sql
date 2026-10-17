-- Bots (COLLECTOR.md §17.3): when each source token was last used, to alert on sources that
-- stopped sending.
ALTER TABLE "collector_tokens" ADD COLUMN "last_used_at" TIMESTAMPTZ;
