import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  buildStudioCatalogItemLookup,
  filterStudioLibraryItems,
  getStudioObjectScopeLabel,
  isStudioItemVisibleToCurrentUser,
  type CatalogSummaryItem,
  type StudioDocument
} from "@studio/shared";
import { cancelStudioRefreshJob, fetchStudioRefreshJob, startStudioRefresh } from "../lib/studioApi";
import { getProfileIdsForCatalogItem, typeLabel } from "../lib/catalog";
import { CatalogCard } from "./CatalogCard";
import { RefreshOverlay } from "./RefreshOverlay";

function formatTimestamp(value?: string) {
  if (!value) return "Not available yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function HomePage({
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
  const [refreshJob, setRefreshJob] = useState<any>(null);
  const currentUserId = String(studioDocument?.session.currentUserId || "").trim();
  const catalogLookup = useMemo(
    () => buildStudioCatalogItemLookup(objects, studioDocument?.bundle.objects),
    [objects, studioDocument]
  );
  const visibleObjects = useMemo(
    () => filterStudioLibraryItems(objects, { currentUserId }),
    [currentUserId, objects]
  );
  const sharedObjects = useMemo(
    () => visibleObjects.filter((item) => item.scope === "global"),
    [visibleObjects]
  );
  const personalObjects = useMemo(
    () => visibleObjects.filter((item) => item.scope === "personal"),
    [visibleObjects]
  );
  const rankedSharedObjects = [...sharedObjects].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  const rankedPersonalObjects = [...personalObjects].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  const reports = rankedSharedObjects.filter((object) => object.type === "report");
  const dashboards = rankedSharedObjects.filter((object) => object.type === "dashboard");
  const recentSharedObjects = recentIds
    .map((id) => catalogLookup.get(id))
    .filter((item): item is CatalogSummaryItem => Boolean(item) && item != null && item.scope === "global" && isStudioItemVisibleToCurrentUser(item, currentUserId))
    .slice(0, 6) || [];
  const favoriteSharedObjects = (studioDocument?.favorites || [])
    .map((id) => catalogLookup.get(id))
    .filter((item): item is CatalogSummaryItem => Boolean(item) && item != null && item.scope === "global" && isStudioItemVisibleToCurrentUser(item, currentUserId))
    .slice(0, 6) || [];
  const personalHighlights = Array.from(new Map(
    [
      ...(studioDocument?.favorites || []).map((id) => catalogLookup.get(id)).filter((item): item is CatalogSummaryItem => Boolean(item) && item != null && item.scope === "personal" && isStudioItemVisibleToCurrentUser(item, currentUserId)),
      ...recentIds.map((id) => catalogLookup.get(id)).filter((item): item is CatalogSummaryItem => Boolean(item) && item != null && item.scope === "personal" && isStudioItemVisibleToCurrentUser(item, currentUserId)),
      ...rankedPersonalObjects
    ].map((item) => [item.id, item])
  ).values()).slice(0, 6);
  const appBrowseGroups = useMemo(() => {
    const profiles = studioDocument?.quickbaseProfiles || [];
    const grouped = profiles.map((profile) => ({
      id: profile.id,
      label: profile.label || "Quickbase app",
      items: rankedSharedObjects.filter((item) => getProfileIdsForCatalogItem(item, studioDocument).includes(profile.id)).slice(0, 8)
    })).filter((group) => group.items.length > 0);
    const unassigned = rankedSharedObjects.filter((item) => getProfileIdsForCatalogItem(item, studioDocument).length === 0).slice(0, 8);
    if (unassigned.length) {
      grouped.push({
        id: "general",
        label: "General",
        items: unassigned
      });
    }
    return grouped;
  }, [rankedSharedObjects, studioDocument]);
  const recentOrLatest = recentSharedObjects.length ? recentSharedObjects : rankedSharedObjects.slice(0, 6);
  const favoritesOrFeatured = favoriteSharedObjects.length ? favoriteSharedObjects : [...dashboards, ...reports].slice(0, 6);
  const appProfiles = studioDocument?.quickbaseProfiles || [];
  const totalCachedRows = appProfiles.reduce((sum, profile) => sum + (profile.refreshStatus.cachedRowCount || 0), 0);
  const healthTone = totalCachedRows > 0 ? "Up to date" : "Needs refresh";

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
    const response = await startStudioRefresh();
    setRefreshJob(response.job);
  }

  async function cancelRefresh() {
    if (!refreshJob?.id) return;
    const refreshJobId = refreshJob.id;
    setRefreshJob(null);
    await cancelStudioRefreshJob(refreshJobId).catch(() => undefined);
  }

  return (
    <section className="surface home-page">
      {refreshJob && refreshJob.status !== "complete" && refreshJob.status !== "failed" && refreshJob.status !== "cancelled" ? (
        <RefreshOverlay title="Refreshing all reports and dashboards" job={refreshJob} onCancel={() => { void cancelRefresh(); }} />
      ) : null}
      <div className="home-shell">
        <section className="home-hero-panel">
          <div className="home-hero-copy">
            <span className="badge brand">Home</span>
            <h1>{studioDocument?.branding.homeLabel || "Reporting platform home"}</h1>
            <p>Everything important in one place: refresh health, connected apps, recent activity, favorites, and fast access to the reports and dashboards people use every day.</p>
          </div>
          <div className="home-hero-actions">
            <button className="ghost-button" onClick={() => { void startFullRefresh(); }}>Refresh all</button>
            <Link className="ghost-button" to="/viewer">Browse reports and dashboards</Link>
            <Link className="ghost-button" to="/help">Open manual</Link>
            <Link className="ghost-button" to="/studio">Open building area</Link>
          </div>
          <div className="home-highlight-grid">
            <div className="home-highlight-card home-highlight-card-primary">
              <span className="micro">Platform health</span>
              <strong>{healthTone}</strong>
              <span>Last refresh {formatTimestamp(studioDocument?.sync.refreshStatus.lastSuccessAt)}</span>
            </div>
            <div className="home-highlight-card">
              <span className="micro">Saved content</span>
              <strong>{objects.length}</strong>
              <span>{reports.length} reports · {dashboards.length} dashboards</span>
            </div>
            <div className="home-highlight-card">
              <span className="micro">Rows saved for faster loading</span>
              <strong>{totalCachedRows.toLocaleString()}</strong>
              <span>Across {appProfiles.length} connected app{appProfiles.length === 1 ? "" : "s"}</span>
            </div>
          </div>
        </section>

        <section className="home-main-grid">
          <div className="home-column home-column-wide">
            <div className="card home-section-card">
              <div className="card-head">
                <strong>{recentSharedObjects.length ? "Recently Opened Shared Content" : "Latest Shared Content"}</strong>
                <span className="micro">{recentSharedObjects.length ? "Quickly reopen shared reports and dashboards" : "Start here if no shared content has been opened yet"}</span>
              </div>
              <div className="viewer-grid home-object-grid">
                {recentOrLatest.length ? recentOrLatest.map((object) => (
                  <CatalogCard
                    key={object.id}
                    className="home-object-card"
                    object={object}
                    studioDocument={studioDocument}
                    openLinksInNewTab={openLinksInNewTab}
                    isFavorite={(studioDocument?.favorites || []).includes(object.id)}
                    onToggleFavorite={onToggleFavorite}
                  />
                )) : (
                  <div className="empty-page">No reports or dashboards are available yet.</div>
                )}
              </div>
            </div>

            <div className="card home-section-card">
              <div className="card-head">
                <strong>{favoriteSharedObjects.length ? "Shared Favorites" : "Featured Shared Dashboards and Reports"}</strong>
                <span className="micro">{favoriteSharedObjects.length ? "Pinned shared items for quick access" : "Helpful shared starting points until favorites are set"}</span>
              </div>
              <div className="viewer-grid home-object-grid">
                {favoritesOrFeatured.length ? favoritesOrFeatured.map((object) => (
                  <CatalogCard
                    key={object.id}
                    className="home-object-card"
                    object={object}
                    studioDocument={studioDocument}
                    openLinksInNewTab={openLinksInNewTab}
                    isFavorite={(studioDocument?.favorites || []).includes(object.id)}
                    onToggleFavorite={onToggleFavorite}
                  />
                )) : (
                  <div className="empty-page">No favorites or featured content are available yet.</div>
                )}
              </div>
            </div>

            {personalObjects.length ? (
              <div className="card home-section-card">
                <div className="card-head">
                  <strong>My Personal Items</strong>
                  <span className="micro">Personal reports and dashboards stay separate from the shared library.</span>
                </div>
                <div className="viewer-grid home-object-grid">
                  {personalHighlights.map((object) => (
                    <CatalogCard
                      key={object.id}
                      className="home-object-card"
                      object={object}
                      studioDocument={studioDocument}
                      openLinksInNewTab={openLinksInNewTab}
                      isFavorite={(studioDocument?.favorites || []).includes(object.id)}
                      onToggleFavorite={onToggleFavorite}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            <div className="card home-section-card">
              <div className="card-head">
                <strong>Browse by App</strong>
                <span className="micro">Open shared reports and dashboards grouped by connected Quickbase app</span>
              </div>
              <div className="home-app-browser">
                {appBrowseGroups.length ? appBrowseGroups.map((group) => (
                  <div className="home-app-browse-card" key={group.id}>
                    <div className="home-app-browse-head">
                      <strong>{group.label}</strong>
                      <span className="micro">{group.items.length} item{group.items.length === 1 ? "" : "s"}</span>
                    </div>
                    <div className="home-app-browse-links">
                      {group.items.map((object) => (
                        <Link
                          key={object.id}
                          className="home-app-browse-link"
                          to={`/${object.type}/${object.id}`}
                          target={openLinksInNewTab ? "_blank" : undefined}
                          rel={openLinksInNewTab ? "noreferrer" : undefined}
                        >
                          <span className="badge">{typeLabel(object.type)}</span>
                          <span className="badge">{getStudioObjectScopeLabel(object)}</span>
                          <strong>{object.name}</strong>
                        </Link>
                      ))}
                    </div>
                  </div>
                )) : (
                  <div className="empty-page">No app-based report or dashboard groups are available yet.</div>
                )}
              </div>
            </div>
          </div>

          <div className="home-column">
            <div className="card home-section-card">
              <div className="card-head">
                <strong>Platform Status</strong>
                <span className="micro">What is happening right now</span>
              </div>
              <div className="home-status-list">
                <div className="home-status-item">
                  <strong>Last full refresh</strong>
                  <span>{formatTimestamp(studioDocument?.sync.refreshStatus.lastSuccessAt)}</span>
                </div>
                <div className="home-status-item">
                  <strong>Next scheduled refresh</strong>
                  <span>{formatTimestamp(studioDocument?.sync.refreshStatus.nextRunAt)}</span>
                </div>
                <div className="home-status-item">
                  <strong>Current refresh message</strong>
                  <span>{studioDocument?.sync.refreshStatus.message || "No refresh has run yet."}</span>
                </div>
                <div className="home-status-item">
                  <strong>Favorites saved</strong>
                  <span>{(studioDocument?.favorites || []).length}</span>
                </div>
              </div>
            </div>

            <div className="card home-section-card">
              <div className="card-head">
                <strong>Connected Apps</strong>
                <span className="micro">Refresh and cache status by app</span>
              </div>
              <div className="home-app-list">
                {appProfiles.length ? appProfiles.map((profile) => (
                  <div className="home-app-item" key={profile.id}>
                    <div className="home-app-head">
                      <strong>{profile.label || "Quickbase app"}</strong>
                      <span className="badge">{profile.liveMode ? "Live mode" : "Cached mode"}</span>
                    </div>
                    <span>Last refresh: {formatTimestamp(profile.refreshStatus.lastSuccessAt)}</span>
                    <span>Next refresh: {formatTimestamp(profile.refreshStatus.nextRunAt)}</span>
                    <span>Rows saved: {(profile.refreshStatus.cachedRowCount || 0).toLocaleString()}</span>
                  </div>
                )) : (
                  <div className="empty">No Quickbase apps are configured yet.</div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
