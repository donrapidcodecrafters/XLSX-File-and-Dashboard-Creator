import type { FastifyBaseLogger } from "fastify";
import { apiConfig, isPostgresEnabled } from "../config/env.js";
import { pgQuery } from "./postgres.js";

const ENTERPRISE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- 2FA: TOTP secret + verified flag (added via ALTER so existing DBs upgrade automatically)
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false;

-- System notification preferences and brute-force protection
ALTER TABLE users ADD COLUMN IF NOT EXISTS system_notifications_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_enc text;

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour',
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- TOTP for whitelist-only users (no full users row) keyed by email
CREATE TABLE IF NOT EXISTS user_totp (
  email text PRIMARY KEY,
  totp_secret text NOT NULL,
  totp_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_totp ADD COLUMN IF NOT EXISTS totp_secret_enc text;

CREATE TABLE IF NOT EXISTS session (
  sid varchar NOT NULL PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);

CREATE TABLE IF NOT EXISTS app_entities (
  id text PRIMARY KEY,
  source_id text NOT NULL UNIQUE,
  source_name text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('quickbase', 'xlsx', 'manual')),
  quickbase_profile_id text NOT NULL DEFAULT '',
  quickbase_table_id text NOT NULL DEFAULT '',
  quickbase_report_id text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  field_count integer NOT NULL DEFAULT 0,
  record_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  refreshed_at timestamptz
);

-- The field that uniquely identifies each record in this table (used to relate tables to each other)
ALTER TABLE app_entities ADD COLUMN IF NOT EXISTS key_field_id text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS app_entities_source_type_idx ON app_entities (source_type);
CREATE INDEX IF NOT EXISTS app_entities_refreshed_at_idx ON app_entities (refreshed_at);

CREATE TABLE IF NOT EXISTS app_attributes (
  id text PRIMARY KEY,
  entity_id text NOT NULL REFERENCES app_entities(id) ON DELETE CASCADE,
  field_id text NOT NULL,
  field_label text NOT NULL,
  field_type text NOT NULL,
  ordinal integer NOT NULL DEFAULT 0,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, field_id)
);

CREATE INDEX IF NOT EXISTS app_attributes_entity_id_idx ON app_attributes (entity_id);
CREATE INDEX IF NOT EXISTS app_attributes_field_id_idx ON app_attributes (field_id);

CREATE TABLE IF NOT EXISTS app_records (
  id bigserial PRIMARY KEY,
  entity_id text NOT NULL REFERENCES app_entities(id) ON DELETE CASCADE,
  source_id text NOT NULL,
  external_record_id text NOT NULL DEFAULT '',
  row_hash text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_records_entity_id_idx ON app_records (entity_id);
CREATE INDEX IF NOT EXISTS app_records_source_id_idx ON app_records (source_id);
CREATE INDEX IF NOT EXISTS app_records_external_record_id_idx ON app_records (source_id, external_record_id);
CREATE INDEX IF NOT EXISTS app_records_payload_gin_idx ON app_records USING gin (payload jsonb_path_ops);

CREATE TABLE IF NOT EXISTS app_sync_jobs (
  id text PRIMARY KEY,
  source_id text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('quickbase', 'xlsx', 'manual')),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'complete', 'failed', 'cancelled')),
  progress integer NOT NULL DEFAULT 0,
  message text NOT NULL DEFAULT '',
  error text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS app_sync_jobs_source_id_idx ON app_sync_jobs (source_id);
CREATE INDEX IF NOT EXISTS app_sync_jobs_status_idx ON app_sync_jobs (status);

CREATE TABLE IF NOT EXISTS report_configs (
  id text PRIMARY KEY,
  object_id text NOT NULL,
  object_type text NOT NULL CHECK (object_type IN ('report', 'dashboard')),
  enabled boolean NOT NULL DEFAULT false,
  cron_expression text NOT NULL DEFAULT '0 * * * *',
  time_zone text NOT NULL DEFAULT 'UTC',
  send_to text[] NOT NULL DEFAULT '{}',
  sendgrid_template_id text NOT NULL DEFAULT '',
  export_format text NOT NULL DEFAULT 'xlsx',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_configs_enabled_next_run_idx ON report_configs (enabled, next_run_at);

CREATE TABLE IF NOT EXISTS export_jobs (
  id text PRIMARY KEY,
  object_id text NOT NULL,
  object_type text NOT NULL CHECK (object_type IN ('report', 'dashboard', 'studio')),
  format text NOT NULL DEFAULT 'xlsx',
  status text NOT NULL CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  progress integer NOT NULL DEFAULT 0,
  message text NOT NULL DEFAULT '',
  filename text NOT NULL DEFAULT '',
  error text NOT NULL DEFAULT '',
  file_path text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS export_jobs_status_idx ON export_jobs (status);
CREATE INDEX IF NOT EXISTS export_jobs_created_at_idx ON export_jobs (created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  user_email text NOT NULL DEFAULT '',
  action text NOT NULL,
  object_type text NOT NULL DEFAULT '',
  object_id text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_user_email_idx ON audit_log (user_email);

-- User roles (admin/editor/viewer — extensible for multi-tenancy)
CREATE TABLE IF NOT EXISTS user_roles (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'editor', 'viewer')),
  granted_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS user_roles_user_id_idx ON user_roles (user_id);
CREATE INDEX IF NOT EXISTS user_roles_role_idx ON user_roles (role);

-- Pending invitations (token-based, 7-day expiry)
CREATE TABLE IF NOT EXISTS user_invitations (
  id text PRIMARY KEY,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'viewer',
  display_name text NOT NULL DEFAULT '',
  token text NOT NULL UNIQUE,
  invited_by text NOT NULL DEFAULT '',
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_invitations_token_idx ON user_invitations (token);
CREATE INDEX IF NOT EXISTS user_invitations_email_idx ON user_invitations (email);

-- Per-user preferences (theme, defaults — extensible)
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme text NOT NULL DEFAULT 'system',
  language text NOT NULL DEFAULT 'en',
  preferences jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Custom roles with JSONB permissions (admin-created, extensible for multi-tenancy)
CREATE TABLE IF NOT EXISTS custom_roles (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#6B7280',
  permissions jsonb NOT NULL DEFAULT '{}',
  is_system boolean NOT NULL DEFAULT false,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS custom_roles_name_idx ON custom_roles (name);

-- Link users to custom roles (in addition to the built-in role in user_roles)
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS custom_role_id text REFERENCES custom_roles(id) ON DELETE SET NULL;
`;

export async function ensureEnterpriseSchema(logger?: FastifyBaseLogger) {
  if (!isPostgresEnabled()) {
    logger?.warn("Postgres disabled: DATABASE_URL/POSTGRES_URL is not configured; using local JSON persistence.");
    return { ok: true, skipped: true };
  }
  if (!apiConfig.postgres.autoMigrate) {
    logger?.info("Postgres auto migration disabled by POSTGRES_AUTO_MIGRATE=false.");
    return { ok: true, skipped: true };
  }
  await pgQuery(ENTERPRISE_SCHEMA_SQL);
  logger?.info("Postgres enterprise schema is ready.");
  return { ok: true, skipped: false };
}
