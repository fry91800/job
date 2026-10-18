-- Six more resume templates, all free (apps/api/src/templates/, previews in
-- apps/web/public/templates/). Existing databases keep any row they already have.
INSERT INTO "templates" ("name", "supports_photo", "preview_storage_key", "renderer_key", "sort_order", "updated_at")
VALUES
  ('Contemporary', true, 'templates/contemporary.jpg', 'contemporary', 3, CURRENT_TIMESTAMP),
  ('Minimal', false, 'templates/minimal.jpg', 'minimal', 4, CURRENT_TIMESTAMP),
  ('Elegant', true, 'templates/elegant.jpg', 'elegant', 5, CURRENT_TIMESTAMP),
  ('Executive', true, 'templates/executive.jpg', 'executive', 6, CURRENT_TIMESTAMP),
  ('Creative', true, 'templates/creative.jpg', 'creative', 7, CURRENT_TIMESTAMP),
  ('Compact', false, 'templates/compact.jpg', 'compact', 8, CURRENT_TIMESTAMP)
ON CONFLICT ("renderer_key") DO NOTHING;

-- Previews are JPEG files named after the renderer (apps/web/public/templates/).
UPDATE "templates" SET "preview_storage_key" = 'templates/' || "renderer_key" || '.jpg';
