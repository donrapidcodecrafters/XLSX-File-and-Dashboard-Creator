export function getHostedContext() {
  const params = new URLSearchParams(window.location.search);
  return {
    embed: params.get("embed") === "1",
    mode: params.get("mode") === "viewer" ? "viewer" : "builder",
    search: params.toString() ? "?" + params.toString() : ""
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
