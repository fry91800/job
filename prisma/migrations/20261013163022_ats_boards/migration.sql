-- DropForeignKey
ALTER TABLE "company_sources" DROP CONSTRAINT "company_sources_company_id_fkey";

-- AlterTable
ALTER TABLE "company_sources" ADD COLUMN     "checked_at" TIMESTAMPTZ,
ADD COLUMN     "discovered_from" TEXT,
ADD COLUMN     "france_job_count" INTEGER,
ADD COLUMN     "job_count" INTEGER,
ADD COLUMN     "last_error" TEXT,
ALTER COLUMN "company_id" DROP NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'candidate';

-- CreateIndex
CREATE INDEX "company_sources_ats_status_idx" ON "company_sources"("ats", "status");

-- AddForeignKey
ALTER TABLE "company_sources" ADD CONSTRAINT "company_sources_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
