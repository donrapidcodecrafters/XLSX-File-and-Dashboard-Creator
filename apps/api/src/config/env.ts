// Load .env from the repo root before anything reads process.env.
// This runs synchronously as the first thing in this module.
// Works regardless of whether the API is started via tsx, pm2, or node directly.
import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
{
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // src/config/env.ts → src/config → src → apps/api → apps → root
  loadDotenv({ path: resolve(__dirname, "../../../../.env"), override: false });
}

type AllowedUserConfig = {
  email: string;
  passwordHash: string;
};

function readString(name: string, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function readBoolean(name: string, fallback = false) {
  const value = readString(name);
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readNumber(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function parseAllowedUsers(): AllowedUserConfig[] {
  const fromList = readString("AUTH_WHITELIST_USERS")
    .split(/[;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [email = "", ...hashParts] = entry.split(":");
      return {
        email: email.trim().toLowerCase(),
        passwordHash: hashParts.join(":").trim()
      };
    })
    .filter((entry) => entry.email && entry.passwordHash);

  const fromIndexed = Array.from({ length: 5 }, (_, index) => index + 1)
    .map((index) => ({
      email: readString(`AUTH_USER_${index}_EMAIL`).toLowerCase(),
      passwordHash: readString(`AUTH_USER_${index}_PASSWORD_HASH`)
    }))
    .filter((entry) => entry.email && entry.passwordHash);

  const deduped = new Map<string, AllowedUserConfig>();
  [...fromList, ...fromIndexed].slice(0, 5).forEach((entry) => {
    deduped.set(entry.email, entry);
  });
  return Array.from(deduped.values());
}

export const apiConfig = {
  server: {
    host: readString("HOST", "0.0.0.0"),
    port: readNumber("PORT", 3001, 1, 65535),
    publicUrl: readString("PUBLIC_APP_URL")
  },
  postgres: {
    url: readString("DATABASE_URL") || readString("POSTGRES_URL"),
    ssl: readBoolean("POSTGRES_SSL", false),
    poolMax: readNumber("POSTGRES_POOL_MAX", 4, 1, 10),
    idleTimeoutMillis: readNumber("POSTGRES_IDLE_TIMEOUT_MS", 30_000, 1_000, 120_000),
    connectionTimeoutMillis: readNumber("POSTGRES_CONNECTION_TIMEOUT_MS", 5_000, 500, 30_000),
    statementTimeoutMillis: readNumber("POSTGRES_STATEMENT_TIMEOUT_MS", 60_000, 1_000, 300_000),
    legacyRowLoadLimit: readNumber("POSTGRES_LEGACY_ROW_LOAD_LIMIT", 100_000, 1_000, 1_000_000),
    autoMigrate: readBoolean("POSTGRES_AUTO_MIGRATE", true)
  },
  auth: {
    enabled: readBoolean("AUTH_ENABLED", false),
    sessionSecret: readString("SESSION_SECRET"),
    sessionCookieName: readString("SESSION_COOKIE_NAME", "studio.sid"),
    sessionTtlHours: readNumber("SESSION_TTL_HOURS", 12, 1, 168),
    allowedUsers: parseAllowedUsers()
  },
  automation: {
    enabled: readBoolean("AUTOMATION_ENABLED", true),
    cronExpression: readString("AUTOMATION_CRON", "0 * * * *"),
    sendgridApiKey: readString("SENDGRID_API_KEY"),
    sendgridFromEmail: readString("SENDGRID_FROM_EMAIL")
  },
  uploads: {
    maxFileBytes: readNumber("UPLOAD_MAX_FILE_BYTES", 25 * 1024 * 1024, 1024 * 1024, 250 * 1024 * 1024)
  }
} as const;

export function isPostgresEnabled() {
  return Boolean(apiConfig.postgres.url);
}
