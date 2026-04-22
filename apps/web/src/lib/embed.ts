type HostedLaunchSource = "quickbase-button" | "local-dev" | null;

function normalizeSearch(rawSearch: string) {
  return String(rawSearch || "")
    .replace(/^\?/, "")
    .replace(/\?/g, "&");
}

export function getHostedContext() {
  const params = new URLSearchParams(normalizeSearch(window.location.search));
  const realmHostname = String(params.get("realm") || params.get("realmHostname") || "").trim().toLowerCase();
  const appId = String(params.get("dbid") || params.get("appId") || "").trim();
  const userId = String(params.get("userId") || params.get("userid") || "").trim();
  const hasQuickbaseLaunchContext = Boolean(realmHostname || appId || userId);
  const rawMode = String(params.get("mode") || "").trim().toLowerCase();
  const launchSource: HostedLaunchSource = params.get("launch") === "quickbase" || params.get("qbLaunch") === "1" || hasQuickbaseLaunchContext
    ? "quickbase-button"
    : params.get("launch") === "local"
      ? "local-dev"
      : null;
  return {
    embed: params.get("embed") === "1",
    mode: rawMode.startsWith("viewer") ? "viewer" : "builder",
    search: params.toString() ? "?" + params.toString() : "",
    launchSource,
    userId,
    realmHostname,
    appId
  };
}

export function buildObjectUrl(type: "report" | "dashboard", id: string, options?: { embed?: boolean; viewer?: boolean }) {
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.search);
  if (options?.embed) params.set("embed", "1");
  else params.delete("embed");
  if (options?.viewer) params.set("mode", "viewer");
  else params.delete("mode");
  url.search = params.toString() ? "?" + params.toString() : "";
  url.hash = "#/" + type + "/" + id;
  return url.toString();
}
