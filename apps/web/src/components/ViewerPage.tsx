import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { filterStudioLibraryItems, type CatalogSummaryItem, type StudioDocument } from "@studio/shared";
import { fetchStudioRefreshJob, startStudioRefresh } from "../lib/studioApi";
import { getProfileIdsForCatalogItem, getProfileLabelsForCatalogItem } from "../lib/catalog";
import { buildHostedRoute } from "../lib/embed";
import { CatalogCard } from "./CatalogCard";
import { ClearableInputField } from "./ClearableInputField";
import { RefreshOverlay } from "./RefreshOverlay";

export function ViewerPage({
  objects,
  studioDocument,
  recentIds,
  refreshAllSignal = 0,
  openLinksInNewTab = false,
  onRefreshComplete,
  onToggleFavorite
}: {
  objects: CatalogSummaryItem[];
  studioDocument: StudioDocument | null;
  recentIds: string[];
  refreshAllSignal?: number;
  openLinksInNewTab?: boolean;
  onRefreshComplete: () => Promise<void>;
  onToggleFavorite: (objectId: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "report" | "dashboard">("all");
  const [scopeFilter, setScopeFilter] = useState<"all" | "global" | "personal">("global");
  const [profileFilter, setProfileFilter] = useState("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [recentOnly, setRecentOnly] = useState(false);
  const [refreshJob, setRefreshJob] = useState<any>(null);
  const [startingRefresh, setStartingRefresh] = useState(false);
  const favorites = studioDocument?.favorites || [];
  const currentUserId = String(studioDocument?.session.currentUserId || "").trim();
  const visibleObjects = useMemo(
    () => filterStudioLibraryItems(objects, { currentUserId }),
    [currentUserId, objects]
  );
  const filtered = useMemo(() => {
    return filterStudioLibraryItems(visibleObjects, {
      currentUserId,
      favorites,
      recentIds,
      query,
      typeFilter,
      scopeFilter,
      favoritesOnly,
      recentOnly,
      includeItem: (object) => profileFilter === "all" || getProfileIdsForCatalogItem(object, studioDocument).includes(profileFilter),
      resolveSearchText: (object) =>
        [object.name, object.description, object.folder, object.category, object.tags.join(" "), getProfileLabelsForCatalogItem(object, studioDocument).join(" ")]
          .join(" ")
    });
  }, [currentUserId, favorites, favoritesOnly, profileFilter, query, recentIds, recentOnly, scopeFilter, studioDocument, typeFilter, visibleObjects]);
  const profileOptions = studioDocument?.quickbaseProfiles || [];

  useEffect(() => {
    if (!refreshJob || refreshJob.status === "complete" || refreshJob.status === "failed" || refreshJob.status === "cancelled") return;
    const handle = window.setInterval(() => {
      fetchStudioRefreshJob(refreshJob.id)
        .then((response) => {
          setRefreshJob(response.job);
          if (response.job.status === "complete" || response.job.status === "failed" || response.job.status === "cancelled") {
            void onRefreshComplete();
          }
        })
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(handle);
  }, [onRefreshComplete, refreshJob]);

  useEffect(() => {
    if (!refreshAllSignal) return;
    void startFullRefresh();
  }, [refreshAllSignal]);

  async function startFullRefresh() {
    setStartingRefresh(true);
    try {
      const response = await startStudioRefresh();
      setRefreshJob(response.job);
    } finally {
      window.setTimeout(() => setStartingRefresh(false), 700);
    }
  }

  return (
    <section className="surface stack viewer-page">
      {startingRefresh && !refreshJob ? (
        <RefreshOverlay title="Starting refresh" indeterminate job={{ message: "Starting a full platform refresh…" }} />
      ) : null}
      {refreshJob && refreshJob.status !== "complete" && refreshJob.status !== "failed" && refreshJob.status !== "cancelled" ? (
        <RefreshOverlay title="Refreshing all reports and dashboards" job={refreshJob} />
      ) : null}
      <div className="hero viewer-hero">
        <div>
          <span className="badge brand">Viewing</span>
          <h1>Open Reports and Dashboards</h1>
          <p>Search, filter, and browse saved content by app, type, favorites, and recent activity before opening a report or dashboard.</p>
        </div>
        <div className="link-toolbar viewer-actions">
          <Link className="ghost-button" to={buildHostedRoute("/help")}>Open manual</Link>
          <Link className="ghost-button" to={buildHostedRoute("/studio")}>Open building area</Link>
        </div>
      </div>

      {scopeFilter === "global" && visibleObjects.some((item) => item.scope === "personal") ? (
        <div className="sync-status sync-status-ok">
          <strong>Shared library view</strong>
          <span>Personal items are hidden here until you switch the scope filter to `Personal only` or `Shared and personal`.</span>
        </div>
      ) : null}

      <div className="viewer-filter-bar">
        <div className="viewer-search-field">
          <ClearableInputField
            label="Search"
            id="viewer-search"
            name="viewerSearch"
            value={query}
            onChange={setQuery}
            placeholder="Search reports, dashboards, folders, tags, or app labels"
          />
        </div>
        <label className="field compact-field">
          <span>Type</span>
          <select aria-label="Type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "all" | "report" | "dashboard")}>
            <option value="all">All content</option>
            <option value="report">Reports</option>
            <option value="dashboard">Dashboards</option>
          </select>
        </label>
        <label className="field compact-field">
          <span>Scope</span>
          <select aria-label="Scope" value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value as "all" | "global" | "personal")}>
            <option value="all">Shared and personal</option>
            <option value="global">Shared only</option>
            <option value="personal">Personal only</option>
          </select>
        </label>
        <label className="field compact-field">
          <span>App</span>
          <select aria-label="App" value={profileFilter} onChange={(event) => setProfileFilter(event.target.value)}>
            <option value="all">All apps</option>
            {profileOptions.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.label || profile.quickbase.appId || profile.id}</option>
            ))}
          </select>
        </label>
        <label className="toggle-row"><input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} /> Favorites</label>
        <label className="toggle-row"><input type="checkbox" checked={recentOnly} onChange={(event) => setRecentOnly(event.target.checked)} /> Recent</label>
      </div>

      <div className="micro-row viewer-summary-row">
        <span>{filtered.length} matching item{filtered.length === 1 ? "" : "s"}</span>
        <span>{visibleObjects.filter((item) => item.scope === "personal").length} personal item{visibleObjects.filter((item) => item.scope === "personal").length === 1 ? "" : "s"}</span>
        <span>{favorites.length} favorite{favorites.length === 1 ? "" : "s"}</span>
        <span>{recentIds.length} recent item{recentIds.length === 1 ? "" : "s"}</span>
      </div>

      <div className="viewer-grid">
        {filtered.map((object) => (
          <CatalogCard
            key={object.id}
            className="viewer-card"
            object={object}
            studioDocument={studioDocument}
            openLinksInNewTab={openLinksInNewTab}
            isFavorite={favorites.includes(object.id)}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
        {!filtered.length ? <div className="empty-page">No reports or dashboards match this search.</div> : null}
      </div>
    </section>
  );
}
