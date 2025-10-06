-- Make old deployment fields nullable to support new schema
ALTER TABLE deployments ALTER COLUMN commit_sha DROP NOT NULL;
ALTER TABLE deployments ALTER COLUMN branch DROP NOT NULL;
ALTER TABLE deployments ALTER COLUMN application DROP NOT NULL;
ALTER TABLE deployments ALTER COLUMN app_id SET NOT NULL;
ALTER TABLE deployments ALTER COLUMN git_commit_id SET NOT NULL;
