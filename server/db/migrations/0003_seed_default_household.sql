-- The household every existing row belongs to.
--
-- Seeded in its own migration, before `household_id` is added, so the column can be created NOT
-- NULL with a default pointing here. That makes the next migration correct whether the tables are
-- empty or not — existing rows are adopted rather than rejected or orphaned.
INSERT INTO "households" ("id", "name")
VALUES ('loewer', 'Loewer')
ON CONFLICT ("id") DO NOTHING;
