-- Cover letters for an offer (FEATURE M5).
-- CreateTable
CREATE TABLE "cover_letters" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "resume_id" UUID,
    "language" VARCHAR(10) NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sender" JSONB NOT NULL,
    "recipient" JSONB NOT NULL,
    "ai_model" TEXT,
    "prompt_version" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "cover_letters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cover_letters_user_id_offer_id_idx" ON "cover_letters"("user_id", "offer_id");

-- CreateIndex
CREATE INDEX "cover_letters_user_id_created_at_idx" ON "cover_letters"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "cover_letters" ADD CONSTRAINT "cover_letters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cover_letters" ADD CONSTRAINT "cover_letters_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cover_letters" ADD CONSTRAINT "cover_letters_resume_id_fkey" FOREIGN KEY ("resume_id") REFERENCES "resumes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

