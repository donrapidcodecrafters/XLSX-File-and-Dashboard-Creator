import type { StudioDocument } from "./models.js";

type StudioSession = StudioDocument["session"];

export interface StudioLaunchContext {
  launchSource?: StudioSession["launchSource"] | null;
  currentUserId?: string;
  launchRealmHostname?: string;
  launchAppId?: string;
}

export interface StudioSessionStatus {
  valid: boolean;
  expired: boolean;
  requiresLaunch: boolean;
  launchSource: StudioSession["launchSource"];
  expiresAt: string;
  remainingMs: number;
  message: string;
}

export function normalizeStudioRealmHostname(value: string | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\.ui\.quickbase\.com$/, ".quickbase.com")
    .replace(/\/+$/, "");
}

export function normalizeStudioAppId(value: string | undefined) {
  return String(value || "").trim().toLowerCase();
}

function toDate(value: Date | number | string | undefined) {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string" && value.trim()) return new Date(value);
  return new Date();
}

function safeIso(value: Date | number | string | undefined) {
  const date = toDate(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function safeTimeoutHours(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 24;
}

export function touchStudioSession(
  session: StudioSession,
  options: {
    now?: Date | number | string;
    currentUserId?: string;
    launchSource?: StudioSession["launchSource"];
    launchRealmHostname?: string;
    launchAppId?: string;
    relaunch?: boolean;
    requiresLaunch?: boolean;
    inactivityTimeoutHours?: number;
  } = {}
): StudioSession {
  const now = toDate(options.now);
  const nowIso = safeIso(now);
  const inactivityTimeoutHours = safeTimeoutHours(options.inactivityTimeoutHours ?? session.inactivityTimeoutHours);
  const launchSource = options.launchSource || session.launchSource || "local-dev";
  const launchRealmHostname = launchSource === "quickbase-button"
    ? normalizeStudioRealmHostname(options.launchRealmHostname ?? session.launchRealmHostname)
    : "";
  const launchAppId = launchSource === "quickbase-button"
    ? normalizeStudioAppId(options.launchAppId ?? session.launchAppId)
    : "";
  const launchedAt = options.relaunch ? nowIso : String(session.launchedAt || nowIso);
  const shouldRefreshActivity = options.relaunch || options.now !== undefined;
  const lastActivityAt = shouldRefreshActivity
    ? nowIso
    : String(session.lastActivityAt || launchedAt || nowIso);
  const existingExpiry = Date.parse(String(session.expiresAt || ""));
  const derivedExpiry = new Date(Date.parse(lastActivityAt || launchedAt || nowIso) + inactivityTimeoutHours * 60 * 60 * 1000).toISOString();
  const expiresAt = shouldRefreshActivity
    ? new Date(now.getTime() + inactivityTimeoutHours * 60 * 60 * 1000).toISOString()
    : (Number.isNaN(existingExpiry) ? derivedExpiry : new Date(existingExpiry).toISOString());
  const lastValidatedAt = options.relaunch || launchSource === "quickbase-button"
    ? (shouldRefreshActivity ? nowIso : String(session.lastValidatedAt || nowIso))
    : String(session.lastValidatedAt || launchedAt || nowIso);

  return {
    ...session,
    currentUserId: String(options.currentUserId ?? session.currentUserId ?? ""),
    launchSource,
    launchRealmHostname,
    launchAppId,
    inactivityTimeoutHours,
    requiresLaunch: options.requiresLaunch ?? session.requiresLaunch ?? true,
    launchedAt,
    lastActivityAt,
    expiresAt,
    lastValidatedAt
  };
}

export function resolveStudioSessionStatus(
  documentOrSession: Pick<StudioDocument, "session"> | StudioSession,
  now: Date | number | string = Date.now(),
  launchContext: StudioLaunchContext = {}
): StudioSessionStatus {
  const session = "session" in documentOrSession ? documentOrSession.session : documentOrSession;
  const current = toDate(now);
  const currentMs = current.getTime();
  const lastSeenAt = Date.parse(session.lastActivityAt || session.launchedAt || current.toISOString());
  const safeLastSeenAt = Number.isNaN(lastSeenAt) ? currentMs : lastSeenAt;
  const derivedExpiry = new Date(safeLastSeenAt + safeTimeoutHours(session.inactivityTimeoutHours) * 60 * 60 * 1000).toISOString();
  const fallbackExpiry = Date.parse(session.expiresAt || derivedExpiry);
  const expiresAt = Number.isNaN(fallbackExpiry) ? currentMs : fallbackExpiry;
  const remainingMs = Math.max(0, expiresAt - currentMs);
  const expired = remainingMs <= 0;
  const currentLaunchSource = launchContext.launchSource || null;
  const currentUserId = String(launchContext.currentUserId || "").trim();
  const currentRealmHostname = normalizeStudioRealmHostname(launchContext.launchRealmHostname);
  const currentAppId = normalizeStudioAppId(launchContext.launchAppId);
  const expectedRealmHostname = normalizeStudioRealmHostname(session.launchRealmHostname);
  const expectedAppId = normalizeStudioAppId(session.launchAppId);
  const expectedUserId = String(session.currentUserId || "").trim();

  let valid = !session.requiresLaunch || !expired;
  let message = valid ? "Session active." : "";

  if (valid && session.requiresLaunch && session.launchSource === "quickbase-button") {
    if (currentLaunchSource !== "quickbase-button") {
      valid = false;
      message = "Open this platform from the Quickbase button for the correct realm and app.";
    } else if (!currentUserId) {
      valid = false;
      message = "Quickbase launch context is missing the user id. Relaunch from the Quickbase button.";
    } else if (expectedUserId && currentUserId !== expectedUserId) {
      valid = false;
      message = "This session belongs to a different Quickbase user. Relaunch from the correct app button.";
    } else if (expectedRealmHostname && currentRealmHostname !== expectedRealmHostname) {
      valid = false;
      message = `This session belongs to ${expectedRealmHostname}. Relaunch from the correct Quickbase realm.`;
    } else if (expectedAppId && currentAppId !== expectedAppId) {
      valid = false;
      message = "This session belongs to a different Quickbase app. Relaunch from the correct app button.";
    }
  }

  if (!message) {
    message = valid
      ? "Session active."
      : session.launchSource === "local-dev"
        ? "Local development session expired. Start a new local session to continue."
        : "Session expired. Relaunch this platform from the Quickbase dashboard button.";
  }

  return {
    valid,
    expired,
    requiresLaunch: session.requiresLaunch === true,
    launchSource: session.launchSource || "local-dev",
    expiresAt: new Date(expiresAt).toISOString(),
    remainingMs,
    message
  };
}
