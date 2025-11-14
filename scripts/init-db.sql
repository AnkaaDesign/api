-- init-db.sql
-- This script runs automatically when PostgreSQL container starts for the first time
-- It ensures proper permissions for the database user

-- Grant all necessary permissions to the user
ALTER USER ankaadesign WITH SUPERUSER CREATEDB CREATEROLE REPLICATION;

-- Create shadow database for Prisma migrations (if it doesn't exist)
SELECT 'CREATE DATABASE ankaa_dev_shadow OWNER ankaadesign'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ankaa_dev_shadow')\gexec

SELECT 'CREATE DATABASE ankaa_staging_shadow OWNER ankaadesign'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ankaa_staging_shadow')\gexec

SELECT 'CREATE DATABASE ankaa_production_shadow OWNER ankaadesign'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ankaa_production_shadow')\gexec

-- Grant all privileges
GRANT ALL PRIVILEGES ON DATABASE ankaa_dev TO ankaadesign;
GRANT ALL PRIVILEGES ON DATABASE ankaa_dev_shadow TO ankaadesign;

-- Set default search path
ALTER DATABASE ankaa_dev SET search_path TO public;

-- Create extensions that might be needed
\c ankaa_dev
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

\c ankaa_dev_shadow
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";