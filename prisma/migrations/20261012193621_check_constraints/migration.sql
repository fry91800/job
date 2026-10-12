-- Rules Prisma cannot express (DATABASE.md "Things Prisma cannot express").

-- A user is either a guest (no email, no password) or registered (both).
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_password_pairing_check"
  CHECK ((email IS NULL) = (password_hash IS NULL));

ALTER TABLE "offers"
  ADD CONSTRAINT "offers_salary_range_check"
  CHECK (salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max);

-- Modifier off = both NULL; modifier on = both set.
ALTER TABLE "generated_resumes"
  ADD CONSTRAINT "generated_resumes_modifier_pairing_check"
  CHECK ((modifier_strength IS NULL) = (modifier_config IS NULL));

-- At most one canonical name per skill/occupation and language.
CREATE UNIQUE INDEX "skill_names_one_canonical_idx"
  ON "skill_names" ("skill_id", "language") WHERE "is_canonical";

CREATE UNIQUE INDEX "occupation_names_one_canonical_idx"
  ON "occupation_names" ("occupation_id", "language") WHERE "is_canonical";
