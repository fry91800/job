-- CreateIndex
CREATE INDEX "occupation_names_name_idx" ON "occupation_names" USING GIN ("name" gin_trgm_ops);
