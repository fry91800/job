-- The resume templates every database needs: users.template_id defaults to 1, so without
-- them no user (guest or account) can be created. The development seed recreates the same
-- rows; existing databases keep theirs.
INSERT INTO "templates" ("id", "name", "supports_photo", "preview_storage_key", "renderer_key", "sort_order", "updated_at")
VALUES
  (1, 'Classic', true, 'templates/classic.png', 'classic', 1, CURRENT_TIMESTAMP),
  (2, 'Modern', false, 'templates/modern.png', 'modern', 2, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

SELECT setval(pg_get_serial_sequence('"templates"', 'id'), GREATEST((SELECT MAX("id") FROM "templates"), 1));
