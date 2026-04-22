#!/bin/bash
# Sync Supabase service role passwords to POSTGRES_PASSWORD.
# Runs automatically on first DB boot via /docker-entrypoint-initdb.d.
# Postgres entrypoint sets POSTGRES_PASSWORD as the password for the
# 'postgres' superuser, which we use here to update the others.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  ALTER ROLE supabase_admin         WITH PASSWORD '${POSTGRES_PASSWORD}';
  ALTER ROLE supabase_auth_admin    WITH PASSWORD '${POSTGRES_PASSWORD}';
  ALTER ROLE authenticator          WITH PASSWORD '${POSTGRES_PASSWORD}';
  ALTER ROLE supabase_storage_admin WITH PASSWORD '${POSTGRES_PASSWORD}';
  ALTER ROLE supabase_replication_admin WITH PASSWORD '${POSTGRES_PASSWORD}';
  ALTER ROLE supabase_read_only_user    WITH PASSWORD '${POSTGRES_PASSWORD}';

  -- Realtime stores its tenant + extension config in this schema.
  -- Pre-create so the realtime container can run its Ecto migrations.
  CREATE SCHEMA IF NOT EXISTS _realtime;
  GRANT ALL ON SCHEMA _realtime TO supabase_admin;
EOSQL
