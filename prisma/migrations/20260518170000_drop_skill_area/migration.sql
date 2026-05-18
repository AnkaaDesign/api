-- ============================================================
-- Drop Skill.area column and SkillArea enum
-- ============================================================
-- The `area` field is redundant — a Skill IS the area (Produtividade,
-- Comportamental, Segurança do Trabalho). Removing the parallel enum
-- simplifies analytics (group by skillId instead of arbitrary enum)
-- and the admin UI (one less redundant select field).
-- ============================================================

-- DropIndex (composite index that referenced area)
DROP INDEX IF EXISTS "Skill_area_order_idx";

-- Recreate index on order alone (new canonical sort key)
CREATE INDEX IF NOT EXISTS "Skill_order_idx" ON "Skill"("order");

-- DropColumn
ALTER TABLE "Skill" DROP COLUMN IF EXISTS "area";

-- DropEnum (no more references)
DROP TYPE IF EXISTS "SkillArea";
