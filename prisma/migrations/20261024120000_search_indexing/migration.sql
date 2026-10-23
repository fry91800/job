-- Search engines told about new and closed offer pages (SEO.md).
CREATE TABLE "search_indexing" (
    "engine" TEXT NOT NULL,
    "cursor_at" TIMESTAMPTZ NOT NULL,
    "day" TEXT NOT NULL,
    "sent_today" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "search_indexing_pkey" PRIMARY KEY ("engine")
);

-- Offers closed after a time (the engines' cursors).
CREATE INDEX "offers_closed_at_idx" ON "offers"("closed_at");
