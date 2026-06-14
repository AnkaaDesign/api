-- Remove duplicate Gratification feature (superseded by Bonificação / Bonus + BonusExtra).
-- Table was just created and is empty (no data loss). Forward-only.
-- NOTE: the PayrollDiscountType.HABITUAL_GRATIFICATION PG enum value is intentionally
-- left in place (inert label only) to avoid risky enum surgery.
DROP TABLE IF EXISTS "Gratification" CASCADE;
