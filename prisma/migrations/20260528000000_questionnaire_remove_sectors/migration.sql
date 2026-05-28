-- Drop the legacy sector-targeting join table. Questionnaires now target
-- collaborators directly (targetUsers) or all users (targetAllUsers); sectors
-- were never wired into the create/open flow.
DROP TABLE "QuestionnaireSector";
