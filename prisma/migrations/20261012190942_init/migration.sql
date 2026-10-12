-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "user_token_type" AS ENUM ('password_reset', 'email_verification');

-- CreateEnum
CREATE TYPE "modifier_strength" AS ENUM ('soft', 'medium', 'hard');

-- CreateEnum
CREATE TYPE "remote_type" AS ENUM ('onsite', 'hybrid', 'remote');

-- CreateEnum
CREATE TYPE "contract_type" AS ENUM ('permanent', 'fixed_term', 'temporary', 'freelance', 'internship', 'apprenticeship', 'other');

-- CreateEnum
CREATE TYPE "salary_period" AS ENUM ('hour', 'day', 'month', 'year');

-- CreateEnum
CREATE TYPE "saved_offer_status" AS ENUM ('saved', 'applied', 'interviewing', 'offer_received', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "location_type" AS ENUM ('city', 'county', 'region', 'country');

-- CreateEnum
CREATE TYPE "relationship_type" AS ENUM ('equivalent', 'related', 'requires', 'alternative');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "password_hash" TEXT,
    "email_verified_at" TIMESTAMPTZ,
    "ui_language" VARCHAR(10) NOT NULL DEFAULT 'fr',
    "last_active_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "search_location_id" INTEGER,
    "modifier_enabled" BOOLEAN NOT NULL DEFAULT false,
    "modifier_strength" "modifier_strength" NOT NULL DEFAULT 'soft',
    "modifier_config" JSONB NOT NULL DEFAULT '{"summary": true, "skills": true, "workExperience": false}',
    "template_id" INTEGER NOT NULL DEFAULT 1,
    "selected_resume_id" UUID,
    "selected_photo_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "last_used_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "user_token_type" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "is_free" BOOLEAN NOT NULL DEFAULT true,
    "supports_photo" BOOLEAN NOT NULL DEFAULT true,
    "preview_storage_key" TEXT NOT NULL,
    "renderer_key" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_photos" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "user_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resumes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "language" VARCHAR(10) NOT NULL,
    "source_file_key" TEXT,
    "translated_from_resume_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "resumes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_resumes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "resume_id" UUID,
    "language" VARCHAR(10) NOT NULL,
    "original_content" JSONB NOT NULL,
    "generated_content" JSONB NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '[]',
    "modifier_strength" "modifier_strength",
    "modifier_config" JSONB,
    "template_id" INTEGER NOT NULL,
    "photo_id" UUID,
    "match_score" INTEGER,
    "ai_model" TEXT,
    "prompt_version" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "generated_resumes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT,
    "type" "location_type" NOT NULL DEFAULT 'city',
    "name" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "region_code" TEXT,
    "region_name" TEXT,
    "county_code" TEXT,
    "county_name" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "company_name" TEXT,
    "description" TEXT NOT NULL,
    "language" VARCHAR(10),
    "url" TEXT,
    "location_id" INTEGER,
    "remote_type" "remote_type",
    "contract_type" "contract_type",
    "salary_min" INTEGER,
    "salary_max" INTEGER,
    "salary_currency" CHAR(3),
    "salary_period" "salary_period",
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL,
    "external_id" TEXT,
    "raw_data" JSONB,
    "created_by_user_id" UUID,
    "published_at" TIMESTAMPTZ,
    "collected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_verified_at" TIMESTAMPTZ,
    "closed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_offers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "status" "saved_offer_status" NOT NULL DEFAULT 'saved',
    "notes" TEXT,
    "applied_at" TIMESTAMPTZ,
    "status_changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "saved_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_names" (
    "id" SERIAL NOT NULL,
    "skill_id" INTEGER NOT NULL,
    "language" VARCHAR(10) NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "is_canonical" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "skill_names_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occupations" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "occupations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occupation_names" (
    "id" SERIAL NOT NULL,
    "occupation_id" INTEGER NOT NULL,
    "language" VARCHAR(10) NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "is_canonical" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "occupation_names_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resume_skills" (
    "resume_id" UUID NOT NULL,
    "skill_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resume_skills_pkey" PRIMARY KEY ("resume_id","skill_id")
);

-- CreateTable
CREATE TABLE "offer_skills" (
    "offer_id" UUID NOT NULL,
    "skill_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_skills_pkey" PRIMARY KEY ("offer_id","skill_id")
);

-- CreateTable
CREATE TABLE "resume_occupations" (
    "resume_id" UUID NOT NULL,
    "occupation_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resume_occupations_pkey" PRIMARY KEY ("resume_id","occupation_id")
);

-- CreateTable
CREATE TABLE "offer_occupations" (
    "offer_id" UUID NOT NULL,
    "occupation_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_occupations_pkey" PRIMARY KEY ("offer_id","occupation_id")
);

-- CreateTable
CREATE TABLE "skill_relationships" (
    "skill_id" INTEGER NOT NULL,
    "related_skill_id" INTEGER NOT NULL,
    "relationship_type" "relationship_type" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_relationships_pkey" PRIMARY KEY ("skill_id","related_skill_id","relationship_type")
);

-- CreateTable
CREATE TABLE "occupation_relationships" (
    "occupation_id" INTEGER NOT NULL,
    "related_occupation_id" INTEGER NOT NULL,
    "relationship_type" "relationship_type" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "occupation_relationships_pkey" PRIMARY KEY ("occupation_id","related_occupation_id","relationship_type")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_selected_resume_id_key" ON "users"("selected_resume_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_selected_photo_id_key" ON "users"("selected_photo_id");

-- CreateIndex
CREATE INDEX "users_last_active_at_idx" ON "users"("last_active_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_tokens_token_hash_key" ON "user_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "user_tokens_user_id_type_idx" ON "user_tokens"("user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "templates_renderer_key_key" ON "templates"("renderer_key");

-- CreateIndex
CREATE UNIQUE INDEX "user_photos_storage_key_key" ON "user_photos"("storage_key");

-- CreateIndex
CREATE INDEX "user_photos_user_id_idx" ON "user_photos"("user_id");

-- CreateIndex
CREATE INDEX "resumes_user_id_idx" ON "resumes"("user_id");

-- CreateIndex
CREATE INDEX "resumes_translated_from_resume_id_idx" ON "resumes"("translated_from_resume_id");

-- CreateIndex
CREATE INDEX "generated_resumes_user_id_offer_id_idx" ON "generated_resumes"("user_id", "offer_id");

-- CreateIndex
CREATE INDEX "generated_resumes_user_id_created_at_idx" ON "generated_resumes"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "locations_country_code_region_code_county_code_idx" ON "locations"("country_code", "region_code", "county_code");

-- CreateIndex
CREATE INDEX "locations_latitude_longitude_idx" ON "locations"("latitude", "longitude");

-- CreateIndex
CREATE UNIQUE INDEX "locations_provider_external_id_key" ON "locations"("provider", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "offers_url_key" ON "offers"("url");

-- CreateIndex
CREATE INDEX "offers_is_public_closed_at_published_at_idx" ON "offers"("is_public", "closed_at", "published_at" DESC);

-- CreateIndex
CREATE INDEX "offers_location_id_idx" ON "offers"("location_id");

-- CreateIndex
CREATE INDEX "offers_created_by_user_id_idx" ON "offers"("created_by_user_id");

-- CreateIndex
CREATE INDEX "offers_title_idx" ON "offers" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "offers_company_name_idx" ON "offers" USING GIN ("company_name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "offers_source_external_id_key" ON "offers"("source", "external_id");

-- CreateIndex
CREATE INDEX "saved_offers_user_id_status_idx" ON "saved_offers"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "saved_offers_user_id_offer_id_key" ON "saved_offers"("user_id", "offer_id");

-- CreateIndex
CREATE UNIQUE INDEX "skills_source_external_id_key" ON "skills"("source", "external_id");

-- CreateIndex
CREATE INDEX "skill_names_language_normalized_name_idx" ON "skill_names"("language", "normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "skill_names_skill_id_language_normalized_name_key" ON "skill_names"("skill_id", "language", "normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "occupations_source_external_id_key" ON "occupations"("source", "external_id");

-- CreateIndex
CREATE INDEX "occupation_names_language_normalized_name_idx" ON "occupation_names"("language", "normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "occupation_names_occupation_id_language_normalized_name_key" ON "occupation_names"("occupation_id", "language", "normalized_name");

-- CreateIndex
CREATE INDEX "resume_skills_skill_id_idx" ON "resume_skills"("skill_id");

-- CreateIndex
CREATE INDEX "offer_skills_skill_id_idx" ON "offer_skills"("skill_id");

-- CreateIndex
CREATE INDEX "resume_occupations_occupation_id_idx" ON "resume_occupations"("occupation_id");

-- CreateIndex
CREATE INDEX "offer_occupations_occupation_id_idx" ON "offer_occupations"("occupation_id");

-- CreateIndex
CREATE INDEX "skill_relationships_related_skill_id_idx" ON "skill_relationships"("related_skill_id");

-- CreateIndex
CREATE INDEX "occupation_relationships_related_occupation_id_idx" ON "occupation_relationships"("related_occupation_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_search_location_id_fkey" FOREIGN KEY ("search_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_selected_resume_id_fkey" FOREIGN KEY ("selected_resume_id") REFERENCES "resumes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_selected_photo_id_fkey" FOREIGN KEY ("selected_photo_id") REFERENCES "user_photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_photos" ADD CONSTRAINT "user_photos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_translated_from_resume_id_fkey" FOREIGN KEY ("translated_from_resume_id") REFERENCES "resumes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_resumes" ADD CONSTRAINT "generated_resumes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_resumes" ADD CONSTRAINT "generated_resumes_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_resumes" ADD CONSTRAINT "generated_resumes_resume_id_fkey" FOREIGN KEY ("resume_id") REFERENCES "resumes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_resumes" ADD CONSTRAINT "generated_resumes_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_resumes" ADD CONSTRAINT "generated_resumes_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "user_photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_offers" ADD CONSTRAINT "saved_offers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_offers" ADD CONSTRAINT "saved_offers_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_names" ADD CONSTRAINT "skill_names_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occupation_names" ADD CONSTRAINT "occupation_names_occupation_id_fkey" FOREIGN KEY ("occupation_id") REFERENCES "occupations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_skills" ADD CONSTRAINT "resume_skills_resume_id_fkey" FOREIGN KEY ("resume_id") REFERENCES "resumes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_skills" ADD CONSTRAINT "resume_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_skills" ADD CONSTRAINT "offer_skills_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_skills" ADD CONSTRAINT "offer_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_occupations" ADD CONSTRAINT "resume_occupations_resume_id_fkey" FOREIGN KEY ("resume_id") REFERENCES "resumes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_occupations" ADD CONSTRAINT "resume_occupations_occupation_id_fkey" FOREIGN KEY ("occupation_id") REFERENCES "occupations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_occupations" ADD CONSTRAINT "offer_occupations_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_occupations" ADD CONSTRAINT "offer_occupations_occupation_id_fkey" FOREIGN KEY ("occupation_id") REFERENCES "occupations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_relationships" ADD CONSTRAINT "skill_relationships_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_relationships" ADD CONSTRAINT "skill_relationships_related_skill_id_fkey" FOREIGN KEY ("related_skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occupation_relationships" ADD CONSTRAINT "occupation_relationships_occupation_id_fkey" FOREIGN KEY ("occupation_id") REFERENCES "occupations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occupation_relationships" ADD CONSTRAINT "occupation_relationships_related_occupation_id_fkey" FOREIGN KEY ("related_occupation_id") REFERENCES "occupations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
