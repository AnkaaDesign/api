-- Incognito questionnaire mode. When true, responses are never attributable to
-- a respondent via the API (per-respondent admin review is blocked, identity is
-- stripped from every payload, admins see only anonymized aggregate results).
ALTER TABLE "Questionnaire" ADD COLUMN "isAnonymous" BOOLEAN NOT NULL DEFAULT false;
