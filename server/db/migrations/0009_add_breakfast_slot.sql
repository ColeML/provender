-- Appended rather than positioned: `ALTER TYPE ... ADD VALUE ... BEFORE` would reorder the enum's
-- ordinals under a live table, and the existing order is already not meal order (dinner, lunch).
-- Nothing sorts on this column -- `MEAL_ORDER` in the schema carries the reading order instead.
--
-- Safe inside the migrator's transaction on Postgres 12+, because no statement here uses the new
-- value; a row written with it has to wait for this to commit.
ALTER TYPE "public"."meal_slot" ADD VALUE 'breakfast';
