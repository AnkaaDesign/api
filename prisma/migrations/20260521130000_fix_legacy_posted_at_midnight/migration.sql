-- One-shot data fix for the legacy "midnight UTC" postedAt rows.
--
-- Before the OFX parser was changed to force noon UTC (commit history in
-- ofx-parser.service.ts), Sicredi DTPOSTED values like "20260518" were stored
-- as `2026-05-18 00:00:00 UTC`. In São Paulo (UTC-3) that displays as
-- `2026-05-17 21:00:00 local` — Monday transactions appear under Sunday in
-- the date-grouped accordion (which keys on the *local* calendar day).
--
-- The parser was fixed to emit noon UTC always; only legacy rows are wrong.
-- Shift them forward 12 hours so the moment lands safely inside the intended
-- calendar day in every timezone. Day-of-month never crosses (00:00 + 12h =
-- 12:00, same day).
UPDATE "BankTransaction"
SET "postedAt" = "postedAt" + INTERVAL '12 hours'
WHERE EXTRACT(HOUR FROM "postedAt") = 0
  AND EXTRACT(MINUTE FROM "postedAt") = 0
  AND EXTRACT(SECOND FROM "postedAt") = 0;
