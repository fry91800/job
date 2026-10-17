-- Job alerts (GROWTH.md phase 2): saved searches whose new offers are emailed.
CREATE TABLE "job_alerts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'daily',
    "paused_at" TIMESTAMPTZ,
    "unsubscribe_token" TEXT NOT NULL,
    "last_run_at" TIMESTAMPTZ NOT NULL,
    "last_sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_alerts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "job_alerts_unsubscribe_token_key" ON "job_alerts"("unsubscribe_token");
CREATE INDEX "job_alerts_user_id_idx" ON "job_alerts"("user_id");
ALTER TABLE "job_alerts" ADD CONSTRAINT "job_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- New offers for the alerts: those collected after a moment.
CREATE INDEX "offers_created_at_idx" ON "offers"("created_at");
