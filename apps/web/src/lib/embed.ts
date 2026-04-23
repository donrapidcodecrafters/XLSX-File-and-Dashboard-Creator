type HostedLaunchSource = "quickbase-button" | "local-dev" | null;

function isLocalHostname(hostname: string) {
  const value = String(hostname || "").trim().toLowerCase();
  return !value
    || value === "localhost"
    || value === "127.0.0.1"
    || value === "::1"
    || value.endsWith(".local");
}

export function normalizeHostedSearch(rawSearch: string) {
  return String(rawSearch || "")
    .replace(/^\?/, "")
    .replace(/\?/g, "&");
}

export function getHostedContext() {
  const params = new URLSearchParams(normalizeHostedSearch(window.location.search));
  const realmHostname = String(params.get("realm") || params.get("realmHostname") || "").trim().toLowerCase();
  const appId = String(params.get("dbid") || params.get("appId") || "").trim();
  const userId = String(params.get("userId") || params.get("userid") || "").trim();
  const hasAnyQuickbaseLaunchContext = Boolean(realmHostname || appId || userId);
  const hasCompleteQuickbaseLaunchContext = Boolean(realmHostname && appId && userId);
  const missingQuickbaseLaunchFields = [
    realmHostname ? "" : "realm",
    appId ? "" : "appId",
    userId ? "" : "userId"
  ].filter(Boolean);
  const rawMode = String(params.get("mode") || "").trim().toLowerCase();
  const hostname = String(window.location.hostname || "").trim().toLowerCase();
  const hostedPortalRequiresLaunch = !isLocalHostname(hostname);
  const launchSource: HostedLaunchSource = params.get("launch") === "quickbase" || params.get("qbLaunch") === "1" || hasCompleteQuickbaseLaunchContext
    ? "quickbase-button"
    : params.get("launch") === "local"
      ? "local-dev"
      : null;
  let sandboxedFrame = false;
  try {
    sandboxedFrame = window.self !== window.top;
  } catch {
    sandboxedFrame = true;
  }
  return {
    embed: params.get("embed") === "1",
    mode: rawMode.startsWith("viewer") ? "viewer" : "builder",
    autoDownload: String(params.get("download") || "").trim().toLowerCase(),
    search: params.toString() ? "?" + params.toString() : "",
    launchSource,
    userId,
    realmHostname,
    appId,
    sandboxedFrame,
    hasAnyQuickbaseLaunchContext,
    hasCompleteQuickbaseLaunchContext,
    missingQuickbaseLaunchFields,
    hostedPortalRequiresLaunch
  };
}

export function buildHostedRoute(pathname: string) {
  const params = new URLSearchParams(normalizeHostedSearch(window.location.search));
  return {
    pathname,
    search: params.toString() ? `?${params.toString()}` : ""
  };
}

export function buildHostedHashUrl(pathname: string, options?: { embed?: boolean; viewer?: boolean; download?: string }) {
  const url = new URL(window.location.href);
  const params = new URLSearchParams(normalizeHostedSearch(url.search));
  if (options?.embed) params.set("embed", "1");
  else params.delete("embed");
  if (options?.viewer) params.set("mode", "viewer");
  else params.delete("mode");
  if (options?.download) params.set("download", options.download);
  else params.delete("download");
  url.search = params.toString() ? "?" + params.toString() : "";
  url.hash = "#" + (pathname.startsWith("/") ? pathname : `/${pathname}`);
  return url.toString();
}

export function buildObjectUrl(type: "report" | "dashboard", id: string, options?: { embed?: boolean; viewer?: boolean; download?: string }) {
  return buildHostedHashUrl(`/${type}/${id}`, options);
}
