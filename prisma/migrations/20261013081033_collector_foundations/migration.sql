-- AlterTable
ALTER TABLE "occupations" ADD COLUMN     "parent_id" INTEGER;

-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "company_id" UUID,
ADD COLUMN     "fingerprint" TEXT,
ADD COLUMN     "quality_score" INTEGER;

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "siren" VARCHAR(9),
    "website" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_sources" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "ats" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_run_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_sources" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "url" TEXT,
    "apply_url" TEXT,
    "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,

    CONSTRAINT "offer_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_offers" (
    "id" BIGSERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collector_runs" (
    "id" UUID NOT NULL,
    "connector" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    "cursor" TEXT,
    "counts" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,

    CONSTRAINT "collector_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collector_tokens" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "collector_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_siren_key" ON "companies"("siren");

-- CreateIndex
CREATE INDEX "companies_normalized_name_idx" ON "companies"("normalized_name");

-- CreateIndex
CREATE INDEX "company_sources_company_id_idx" ON "company_sources"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_sources_ats_slug_key" ON "company_sources"("ats", "slug");

-- CreateIndex
CREATE INDEX "offer_sources_offer_id_idx" ON "offer_sources"("offer_id");

-- CreateIndex
CREATE INDEX "offer_sources_url_idx" ON "offer_sources"("url");

-- CreateIndex
CREATE UNIQUE INDEX "offer_sources_source_external_id_key" ON "offer_sources"("source", "external_id");

-- CreateIndex
CREATE INDEX "raw_offers_source_external_id_idx" ON "raw_offers"("source", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "raw_offers_source_external_id_content_hash_key" ON "raw_offers"("source", "external_id", "content_hash");

-- CreateIndex
CREATE INDEX "collector_runs_connector_started_at_idx" ON "collector_runs"("connector", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "collector_tokens_token_hash_key" ON "collector_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "occupations_parent_id_idx" ON "occupations"("parent_id");

-- CreateIndex
CREATE INDEX "offers_company_id_idx" ON "offers"("company_id");

-- CreateIndex
CREATE INDEX "offers_fingerprint_idx" ON "offers"("fingerprint");

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occupations" ADD CONSTRAINT "occupations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "occupations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_sources" ADD CONSTRAINT "company_sources_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_sources" ADD CONSTRAINT "offer_sources_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
