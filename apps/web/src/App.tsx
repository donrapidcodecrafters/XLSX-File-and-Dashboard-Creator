import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import {
  filterStudioLibraryItems,
  getStudioObjectScopeLabel,
  normalizeStudioDocument,
  resolveStudioSessionStatus,
  touchStudioSession,
  type CatalogSummaryItem,
  type RefreshJobStatus,
  type ReportDefinition,
  type ReportFocusMode,
  type StudioDocument,
  type StudioObject,
  type TableDefinition
} from "@studio/shared";
import { DashboardView } from "./components/DashboardView";
import { HelpPage } from "./components/HelpPage";
import { HomePage } from "./components/HomePage";
import { RefreshOverlay } from "./components/RefreshOverlay";
import { ReportView } from "./components/ReportView";
import { StudioPage } from "./components/StudioPage";
import { ViewerPage } from "./components/ViewerPage";
import { fetchCatalog, fetchObject, fetchTables, runReport, runReportPage } from "./lib/api";
import {
  applyLaunchScopeToDocument,
  filterTablesForLaunchScope,
  getProfileIdsForObject,
  isCatalogItemInLaunchScope,
  isObjectInLaunchScope,
  resolveTableDefinition,
  toggleFavoriteIds,
  typeLabel
} from "./lib/catalog";
import { buildHostedRoute, getHostedContext } from "./lib/embed";
import type { QuickbaseTableLinkContext } from "./lib/quickbaseLinks";
import { fetchStudioDocument, fetchStudioRefreshJob, saveStudioUserSettings, startStudioObjectRefresh, updateStudioSession } from "./lib/studioApi";

const SESSION_RECENT_KEY = "studio-session-recent";
const SESSION_PERSIST_INTERVAL_MS = 5 * 60_000;
const SHARED_BROWSER_SESSION_KEY = "studio-shared-browser-session-v1";
const SESSION_ACTIVITY_TOUCH_INTERVAL_MS = 60_000;

function parseSharedBrowserSession(raw: string | null) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { session?: StudioDocument["session"]; savedAt?: number };
    return parsed?.session ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeSessionScopeKey(session: StudioDocument["session"] | null | undefined) {
  if (!session) return "";
  return JSON.stringify({
    launchSource: session.launchSource || "",
    currentUserId: String(session.currentUserId || "").trim(),
    launchRealmHostname: String(session.launchRealmHostname || "").trim().toLowerCase(),
    launchAppId: String(session.launchAppId || "").trim().toLowerCase()
  });
}

function sessionIsNewer(left: StudioDocument["session"] | null | undefined, right: StudioDocument["session"] | null | undefined) {
  const leftTime = Date.parse(String(left?.lastActivityAt || left?.lastValidatedAt || ""));
  const rightTime = Date.parse(String(right?.lastActivityAt || right?.lastValidatedAt || ""));
  const safeLeft = Number.isNaN(leftTime) ? 0 : leftTime;
  const safeRight = Number.isNaN(rightTime) ? 0 : rightTime;
  return safeLeft > safeRight;
}

function getQuickbaseLinkContextForTable(table: TableDefinition | undefined, studioDocument: StudioDocument | null): QuickbaseTableLinkContext | null {
  if (!table || !studioDocument) return null;
  const profile = studioDocument.quickbaseProfiles.find((item) => item.id === table.quickbaseProfileId);
  const quickbase = profile?.quickbase || studioDocument.quickbase;
  const realmHostname = String(quickbase.realmHostname || "").trim();
  const tableId = String(table.quickbaseTableId || table.id || "").trim();
  if (!realmHostname || !tableId) return null;
  return {
    realmHostname,
    tableId
  };
}

function useCatalog() {
  const [objects, setObjects] = useState<CatalogSummaryItem[]>([]);
  const [tables, setTables] = useState<TableDefinition[]>([]);
  const [studioDocument, setStudioDocument] = useState<StudioDocument | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const lastPersistedSessionKey = useRef("");
  const lastPersistedSessionAt = useRef(0);
  const sessionPersistPromise = useRef<Promise<void> | null>(null);
  const queuedSessionPayload = useRef<Partial<StudioDocument["session"]> | null>(null);
  const queuedSessionKey = useRef("");
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try {
      const raw = window.sessionStorage.getItem(SESSION_RECENT_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  });

  const reloadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError("");
    const [catalogResponse, tablesResponse, studioResponse] = await Promise.allSettled([
      fetchCatalog(),
      fetchTables(),
      fetchStudioDocument().catch(() => null)
    ]);
    if (catalogResponse.status === "fulfilled") {
      setObjects(catalogResponse.value.objects);
    } else {
      setObjects([]);
    }
    if (tablesResponse.status === "fulfilled") {
      setTables(tablesResponse.value.tables);
    } else {
      setTables([]);
    }
    if (studioResponse.status === "fulfilled" && studioResponse.value?.document) {
      const normalized = normalizeStudioDocument(studioResponse.value.document);
      lastPersistedSessionKey.current = JSON.stringify(normalized.session || {});
      lastPersistedSessionAt.current = Date.now();
      setStudioDocument(normalized);
    } else if (studioResponse.status === "rejected") {
      setStudioDocument(null);
    }
    if (catalogResponse.status === "rejected" || tablesResponse.status === "rejected") {
      setCatalogError("Some platform data took too long to load. The app is using what it could load and you can retry with Refresh all.");
    }
    setCatalogLoading(false);
  }, []);

  const updateUserSettings = useCallback(async (payload: {
    favorites?: string[];
    recent?: string[];
    personalOverrides?: StudioDocument["personalOverrides"];
  }) => {
    const response = await saveStudioUserSettings(payload);
    setStudioDocument(normalizeStudioDocument(response.document));
  }, []);

  const persistSession = useCallback(async (session: Partial<StudioDocument["session"]>) => {
    const payloadKey = JSON.stringify(session || {});
    const now = Date.now();
    if (
      payloadKey === lastPersistedSessionKey.current
      && now - lastPersistedSessionAt.current < SESSION_PERSIST_INTERVAL_MS
    ) {
      return;
    }
    queuedSessionPayload.current = session;
    queuedSessionKey.current = payloadKey;
    if (sessionPersistPromise.current) {
      return sessionPersistPromise.current;
    }
    sessionPersistPromise.current = (async () => {
      while (queuedSessionPayload.current) {
        const nextPayload = queuedSessionPayload.current;
        const nextKey = queuedSessionKey.current;
        queuedSessionPayload.current = null;
        queuedSessionKey.current = "";
        if (
          nextKey === lastPersistedSessionKey.current
          && Date.now() - lastPersistedSessionAt.current < SESSION_PERSIST_INTERVAL_MS
        ) {
          continue;
        }
        const response = await updateStudioSession(nextPayload);
        const normalized = normalizeStudioDocument(response.document);
        lastPersistedSessionKey.current = JSON.stringify(normalized.session || {});
        lastPersistedSessionAt.current = Date.now();
        setStudioDocument(normalized);
      }
    })().finally(() => {
      sessionPersistPromise.current = null;
    });
    return sessionPersistPromise.current;
  }, []);

  const markObjectAsRecent = useCallback((objectId: string) => {
    if (!objectId) return;
    setRecentIds((current) => {
      const next = [objectId, ...current.filter((item) => item !== objectId)].slice(0, 10);
      try {
        window.sessionStorage.setItem(SESSION_RECENT_KEY, JSON.stringify(next));
      } catch {}
      void updateUserSettings({ recent: next });
      return next;
    });
  }, [updateUserSettings]);

  useEffect(() => {
    void reloadCatalog();
  }, []);

  return { objects, tables, studioDocument, recentIds, reloadCatalog, markObjectAsRecent, updateUserSettings, persistSession, setStudioDocument, catalogLoading, catalogError };
}

function formatTimestamp(value?: string) {
  if (!value) return "Not available yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function sessionsMatch(left: StudioDocument["session"] | null | undefined, right: StudioDocument["session"] | null | undefined) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

function getDashboardPersonalOverride(dashboardId: string, studioDocument: StudioDocument | null) {
  if (!dashboardId || !studioDocument) return null;
  return studioDocument.personalOverrides.dashboards[dashboardId] || null;
}

function getReportPersonalOverride(reportId: string, studioDocument: StudioDocument | null) {
  if (!reportId || !studioDocument) return null;
  return studioDocument.personalOverrides.reports[reportId] || null;
}

function ObjectPage({
  tables,
  platformName,
  studioDocument,
  launchContext,
  openLinksInNewTab = false,
  onObjectViewed,
  onUserSettingsChange,
  onToggleFavorite
}: {
  tables: TableDefinition[];
  platformName: string;
  studioDocument: StudioDocument | null;
  launchContext: ReturnType<typeof getHostedContext>;
  openLinksInNewTab?: boolean;
  onObjectViewed: (objectId: string) => void;
  onUserSettingsChange: (payload: {
    favorites?: string[];
    recent?: string[];
    personalOverrides?: StudioDocument["personalOverrides"];
  }) => Promise<void>;
  onToggleFavorite: (objectId: string) => Promise<void>;
}) {
  const params = useParams();
  const [object, setObject] = useState<StudioObject | null>(null);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [refreshJob, setRefreshJob] = useState<any>(null);
  const pageSize = 100;
  const liveModeEnabled = useMemo(
    () => getProfileIdsForObject(object, tables, studioDocument)
      .some((profileId) => studioDocument?.quickbaseProfiles.find((profile) => profile.id === profileId)?.liveMode === true),
    [object, studioDocument, tables]
  );

  async function reloadObject(targetObjectId = params.objectId) {
    if (!targetObjectId) return;
    setLoading(true);
    try {
      const response = await fetchObject(targetObjectId);
      setObject(response.object);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!params.objectId) return;
    let active = true;
    setLoading(true);
    setRefreshNonce(0);
    setRefreshJob(null);
    fetchObject(params.objectId)
      .then((response) => {
        if (!active) return;
        const reportOverride = response.object.type === "report" && response.object.scope === "global"
          ? getReportPersonalOverride(response.object.id, studioDocument)
          : null;
        setPage(reportOverride?.currentPage || 1);
        setObject(response.object);
        setResult(null);
        onObjectViewed(response.object.id);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onObjectViewed, params.objectId]);

  useEffect(() => {
    if (object) {
      document.title = object.name + " · " + platformName;
    }
  }, [object, platformName]);

  useEffect(() => {
    if (!object || object.type !== "report" || object.scope !== "global") return;
    const reportOverride = getReportPersonalOverride(object.id, studioDocument);
    const overridePage = Math.max(1, reportOverride?.currentPage || 1);
    if (overridePage !== page) {
      setPage(overridePage);
    }
  }, [object?.id, object?.scope, object?.type, studioDocument]);

  useEffect(() => {
    if (!object || object.type !== "report") return;
    let active = true;
    setLoading(true);
    const fetcher = page === 1
      ? runReport(object.id, [], { forceLive: liveModeEnabled })
      : runReportPage(object.id, page, pageSize, [], { forceLive: liveModeEnabled });
    fetcher
      .then((reportResult) => {
        if (!active) return;
        setRefreshJob(reportResult.refreshJob || null);
        setResult((current: any) => page === 1 || !current
          ? reportResult
          : {
              ...current,
              rows: reportResult.rows,
              totalRows: reportResult.totalRows,
              page: reportResult.page,
              pageSize: reportResult.pageSize,
              totalPages: reportResult.totalPages,
              hasNextPage: reportResult.hasNextPage
            });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [liveModeEnabled, object?.id, object?.type, page, refreshNonce]);

  useEffect(() => {
    if (!refreshJob || refreshJob.status === "complete" || refreshJob.status === "failed" || refreshJob.status === "cancelled") return;
    const handle = window.setInterval(() => {
      fetchStudioRefreshJob(refreshJob.id)
        .then((response) => {
          setRefreshJob(response.job);
          if (response.job.status === "complete") {
            setRefreshJob(null);
            setRefreshNonce((current) => current + 1);
            setLoading(true);
          } else if (response.job.status === "cancelled") {
            setRefreshJob(null);
            setLoading(false);
          }
        })
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(handle);
  }, [refreshJob]);

  async function startObjectRefresh() {
    if (!object) return;
    const response = await startStudioObjectRefresh(object.id);
    setRefreshJob(response.job);
  }

  if (!params.objectId) return null;
  if (!object && loading) return <div className="empty-page">Loading report or dashboard…</div>;
  if (!object) return <div className="empty-page">That report or dashboard could not be found.</div>;
  if (!isObjectInLaunchScope(object, tables, studioDocument, launchContext)) {
    return <div className="empty-page">That report or dashboard is not available for this Quickbase realm and app.</div>;
  }
  if (object.scope === "personal" && String(studioDocument?.session.currentUserId || "").trim() !== String(object.ownerUserId || "").trim()) {
    return <div className="empty-page">That personal report or dashboard is not available for this session.</div>;
  }

  if (object.type === "report") {
    const table = resolveTableDefinition(tables, object.sourceTableId);
    const quickbaseLinkContext = getQuickbaseLinkContextForTable(table, studioDocument);
    const personalOverride = object.scope === "global" ? getReportPersonalOverride(object.id, studioDocument) : null;
    return (
      <>
        {liveModeEnabled ? (
          <div className="sync-status sync-status-warn">
            <strong>Live mode enabled</strong>
            <span>This report is loading live Quickbase data directly, so loading can take significantly longer.</span>
          </div>
        ) : null}
        {refreshJob && refreshJob.status !== "complete" && refreshJob.status !== "failed" && refreshJob.status !== "cancelled" ? (
          <RefreshOverlay title="Refreshing this report" job={refreshJob} />
        ) : null}
        <ReportView
          report={object as ReportDefinition}
          table={table}
          quickbaseLinkContext={quickbaseLinkContext}
          result={result}
          loading={loading}
          currentPage={page}
          onPageChange={setPage}
          onRefresh={() => { void startObjectRefresh(); }}
          initialFocusMode={(personalOverride?.focusMode || "default") as ReportFocusMode}
          initialFocusedSection={personalOverride?.focusedSection || ""}
          savedViews={personalOverride?.savedViews || []}
          onSaveView={(view) => {
            if (object.scope !== "global" || !studioDocument) return;
            const nextPersonalOverrides: StudioDocument["personalOverrides"] = {
              ...studioDocument.personalOverrides,
              reports: {
                ...studioDocument.personalOverrides.reports,
                [object.id]: {
                  currentPage: Math.max(1, page || 1),
                  focusMode: personalOverride?.focusMode || "default",
                  focusedSection: personalOverride?.focusedSection || "",
                  savedViews: [...(personalOverride?.savedViews || []), { ...view, updatedAt: new Date().toISOString() }],
                  updatedAt: new Date().toISOString()
                }
              }
            };
            void onUserSettingsChange({ personalOverrides: nextPersonalOverrides });
          }}
          onDeleteView={(viewId) => {
            if (object.scope !== "global" || !studioDocument) return;
            const nextPersonalOverrides: StudioDocument["personalOverrides"] = {
              ...studioDocument.personalOverrides,
              reports: {
                ...studioDocument.personalOverrides.reports,
                [object.id]: {
                  currentPage: Math.max(1, personalOverride?.currentPage || 1),
                  focusMode: (personalOverride?.focusMode || "default") as ReportFocusMode,
                  focusedSection: personalOverride?.focusedSection || "",
                  savedViews: (personalOverride?.savedViews || []).filter((view) => view.id !== viewId),
                  updatedAt: new Date().toISOString()
                }
              }
            };
            void onUserSettingsChange({ personalOverrides: nextPersonalOverrides });
          }}
          onStateChange={(state) => {
            if (object.scope !== "global" || !studioDocument) return;
            const nextPersonalOverrides: StudioDocument["personalOverrides"] = {
              ...studioDocument.personalOverrides,
              reports: {
                ...studioDocument.personalOverrides.reports,
                [object.id]: {
                  currentPage: Math.max(1, state.currentPage || 1),
                  focusMode: state.focusMode,
                  focusedSection: state.focusedSection,
                  savedViews: personalOverride?.savedViews || [],
                  updatedAt: new Date().toISOString()
                }
              }
            };
            void onUserSettingsChange({ personalOverrides: nextPersonalOverrides });
          }}
          isFavorite={(studioDocument?.favorites || []).includes(object.id)}
          onToggleFavorite={() => { void onToggleFavorite(object.id); }}
          openLinksInNewTab={openLinksInNewTab}
        />
      </>
    );
  }

  const personalOverride = object.scope === "global" ? getDashboardPersonalOverride(object.id, studioDocument) : null;

  return (
    <>
      {liveModeEnabled ? (
        <div className="sync-status sync-status-warn">
          <strong>Live mode enabled</strong>
          <span>This dashboard is loading live Quickbase data directly, so loading can take significantly longer.</span>
        </div>
      ) : null}
      {refreshJob && refreshJob.status !== "complete" && refreshJob.status !== "failed" && refreshJob.status !== "cancelled" ? (
        <RefreshOverlay title="Refreshing this dashboard" job={refreshJob} />
      ) : null}
      <DashboardView
        dashboard={object}
        tables={tables}
        getQuickbaseLinkContext={(tableId) => getQuickbaseLinkContextForTable(resolveTableDefinition(tables, tableId), studioDocument)}
        refreshNonce={refreshNonce}
        onRefresh={() => { void startObjectRefresh(); }}
        initialRuntimeFilters={personalOverride?.runtimeFilters}
        initialActiveTabId={personalOverride?.activeTabId}
        initialFocusedWidgetId={personalOverride?.focusedWidgetId}
        savedViews={personalOverride?.savedViews || []}
        onSaveView={(view) => {
          if (object.scope !== "global" || !studioDocument) return;
          const nextPersonalOverrides: StudioDocument["personalOverrides"] = {
            ...studioDocument.personalOverrides,
            dashboards: {
              ...studioDocument.personalOverrides.dashboards,
              [object.id]: {
                runtimeFilters: personalOverride?.runtimeFilters || {},
                activeTabId: personalOverride?.activeTabId || "",
                focusedWidgetId: personalOverride?.focusedWidgetId || "",
                savedViews: [...(personalOverride?.savedViews || []), { ...view, updatedAt: new Date().toISOString() }],
                updatedAt: new Date().toISOString()
              }
            }
          };
          void onUserSettingsChange({ personalOverrides: nextPersonalOverrides });
        }}
        onDeleteView={(viewId) => {
          if (object.scope !== "global" || !studioDocument) return;
          const nextPersonalOverrides: StudioDocument["personalOverrides"] = {
            ...studioDocument.personalOverrides,
            dashboards: {
              ...studioDocument.personalOverrides.dashboards,
              [object.id]: {
                runtimeFilters: personalOverride?.runtimeFilters || {},
                activeTabId: personalOverride?.activeTabId || "",
                focusedWidgetId: personalOverride?.focusedWidgetId || "",
                savedViews: (personalOverride?.savedViews || []).filter((view) => view.id !== viewId),
                updatedAt: new Date().toISOString()
              }
            }
          };
          void onUserSettingsChange({ personalOverrides: nextPersonalOverrides });
        }}
        isFavorite={(studioDocument?.favorites || []).includes(object.id)}
        onToggleFavorite={() => { void onToggleFavorite(object.id); }}
        onStateChange={(state) => {
          if (object.scope !== "global" || !studioDocument) return;
          const nextPersonalOverrides: StudioDocument["personalOverrides"] = {
            ...studioDocument.personalOverrides,
            dashboards: {
              ...studioDocument.personalOverrides.dashboards,
              [object.id]: {
                runtimeFilters: state.runtimeFilters,
                activeTabId: state.activeTabId,
                focusedWidgetId: state.focusedWidgetId,
                savedViews: personalOverride?.savedViews || [],
                updatedAt: new Date().toISOString()
              }
            }
          };
          void onUserSettingsChange({ personalOverrides: nextPersonalOverrides });
        }}
        forceLive={liveModeEnabled}
        openLinksInNewTab={openLinksInNewTab}
        onRefreshJobDetected={(job: RefreshJobStatus | null) => setRefreshJob(job)}
      />
    </>
  );
}

export function App() {
  const { objects, tables, studioDocument, recentIds, reloadCatalog, markObjectAsRecent, updateUserSettings, persistSession, setStudioDocument, catalogLoading, catalogError } = useCatalog();
  const location = useLocation();
  const hosted = useMemo(() => getHostedContext(), [location.key]);
  const lastSessionTouchAt = useRef(0);
  const sessionPreview = useMemo(
    () => studioDocument && hosted.launchSource
      ? touchStudioSession(studioDocument.session, {
          launchSource: hosted.launchSource,
          currentUserId: hosted.userId || studioDocument.session.currentUserId,
          launchRealmHostname: hosted.realmHostname,
          launchAppId: hosted.appId,
          requiresLaunch: true
        })
      : studioDocument?.session || null,
    [hosted.appId, hosted.launchSource, hosted.realmHostname, hosted.userId, studioDocument]
  );
  const currentUserId = String(sessionPreview?.currentUserId || "").trim();
  const sessionScopeKey = useMemo(
    () => normalizeSessionScopeKey(sessionPreview || studioDocument?.session || null),
    [sessionPreview, studioDocument?.session]
  );
  const hostedLaunchRequiredMessage = useMemo(() => {
    if (!hosted.hostedPortalRequiresLaunch) return "";
    if (hosted.hasCompleteQuickbaseLaunchContext) return "";
    const missingFields = hosted.missingQuickbaseLaunchFields.length
      ? hosted.missingQuickbaseLaunchFields.join(", ")
      : "realm, appId, userId";
    return `Open this platform from the Quickbase button with all required launch values. Missing: ${missingFields}.`;
  }, [hosted.hasCompleteQuickbaseLaunchContext, hosted.hostedPortalRequiresLaunch, hosted.missingQuickbaseLaunchFields]);
  const sessionStatus = useMemo(
    () => sessionPreview ? resolveStudioSessionStatus(sessionPreview, Date.now(), {
      launchSource: hosted.launchSource,
      currentUserId: hosted.userId,
      launchRealmHostname: hosted.realmHostname,
      launchAppId: hosted.appId
    }) : null,
    [hosted.appId, hosted.launchSource, hosted.realmHostname, hosted.userId, sessionPreview]
  );
  const sessionScopedDocument = useMemo(
    () => studioDocument && sessionPreview
      ? normalizeStudioDocument({ ...studioDocument, session: sessionPreview })
      : studioDocument,
    [sessionPreview, studioDocument]
  );
  const displayDocument = useMemo(
    () => applyLaunchScopeToDocument(sessionScopedDocument, {
      launchSource: hosted.launchSource,
      currentUserId,
      launchRealmHostname: hosted.realmHostname,
      launchAppId: hosted.appId
    }),
    [currentUserId, hosted.appId, hosted.launchSource, hosted.realmHostname, sessionScopedDocument]
  );
  const scopedTables = useMemo(
    () => filterTablesForLaunchScope(tables, sessionScopedDocument, {
      launchSource: hosted.launchSource,
      currentUserId,
      launchRealmHostname: hosted.realmHostname,
      launchAppId: hosted.appId
    }),
    [currentUserId, hosted.appId, hosted.launchSource, hosted.realmHostname, sessionScopedDocument, tables]
  );
  const bootstrapIssues = useMemo(
    () => (displayDocument?.quickbaseProfiles || []).filter((profile) => !profile.bootstrap.ready || profile.bootstrap.autoProvisioned || profile.bootstrap.error),
    [displayDocument]
  );
  const visibleObjects = useMemo(
    () => filterStudioLibraryItems(
      objects.filter((item) => isCatalogItemInLaunchScope(item, sessionScopedDocument, {
        launchSource: hosted.launchSource,
        currentUserId,
        launchRealmHostname: hosted.realmHostname,
        launchAppId: hosted.appId
      })),
      { currentUserId }
    ),
    [currentUserId, hosted.appId, hosted.launchSource, hosted.realmHostname, objects, sessionScopedDocument]
  );
  const [studioSettingsSignal, setStudioSettingsSignal] = useState(0);
  const [studioRefreshSignal, setStudioRefreshSignal] = useState(0);
  const [viewerRefreshSignal, setViewerRefreshSignal] = useState(0);
  const [homeRefreshSignal, setHomeRefreshSignal] = useState(0);
  const homeRoute = location.pathname === "/";
  const helpRoute = location.pathname === "/help";
  const studioRoute = location.pathname.startsWith("/studio");
  const viewerRoute = location.pathname === "/viewer";
  const readerRoute = /^\/(report|dashboard)\//.test(location.pathname);
  const platformName = studioDocument?.branding.platformName || "Reporting Portal";
  const openLinksInNewTab = studioDocument?.branding.openLinksInNewTab === true;
  const navLabel = studioDocument?.branding.navigationLabel || "Reports and Dashboards";
  const readerFullScreen = readerRoute || hosted.mode === "viewer" || hosted.embed;
  const hideSidebar = hosted.embed || studioRoute || readerRoute || viewerRoute || homeRoute || helpRoute;
  const toggleFavorite = useCallback(async (objectId: string) => {
    if (!studioDocument) return;
    const next = toggleFavoriteIds(studioDocument.favorites || [], objectId);
    await updateUserSettings({ favorites: next });
  }, [studioDocument, updateUserSettings]);

  useEffect(() => {
    if (!studioDocument || !hosted.launchSource) return;
    const nextSession = touchStudioSession(studioDocument.session, {
      now: Date.now(),
      relaunch: true,
      launchSource: hosted.launchSource,
      currentUserId: hosted.userId || studioDocument.session.currentUserId,
      launchRealmHostname: hosted.realmHostname,
      launchAppId: hosted.appId,
      requiresLaunch: true
    });
    if (sessionsMatch(studioDocument.session, nextSession)) return;
    setStudioDocument((current) => current ? normalizeStudioDocument({ ...current, session: nextSession }) : current);
    void persistSession(nextSession).catch(() => undefined);
  }, [hosted.appId, hosted.launchSource, hosted.realmHostname, hosted.userId, persistSession, setStudioDocument, studioDocument]);

  useEffect(() => {
    if (!studioDocument || !sessionStatus?.valid) return;
    const touch = () => {
      const now = Date.now();
      if (now - lastSessionTouchAt.current < SESSION_ACTIVITY_TOUCH_INTERVAL_MS) return;
      lastSessionTouchAt.current = now;
      const nextSession = touchStudioSession(sessionPreview || studioDocument.session, { now });
      setStudioDocument((current) => current ? normalizeStudioDocument({ ...current, session: nextSession }) : current);
      void persistSession(nextSession).catch(() => undefined);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") touch();
    };
    window.addEventListener("pointerdown", touch, { passive: true });
    window.addEventListener("keydown", touch);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [persistSession, sessionPreview, sessionStatus?.valid, setStudioDocument, studioDocument]);

  useEffect(() => {
    if (!sessionPreview || !sessionScopeKey) return;
    try {
      window.localStorage.setItem(SHARED_BROWSER_SESSION_KEY, JSON.stringify({
        savedAt: Date.now(),
        session: sessionPreview
      }));
    } catch {}
  }, [sessionPreview, sessionScopeKey]);

  useEffect(() => {
    if (!studioDocument || !sessionScopeKey) return;
    const stored = parseSharedBrowserSession(window.localStorage.getItem(SHARED_BROWSER_SESSION_KEY));
    if (!stored?.session) return;
    if (normalizeSessionScopeKey(stored.session) !== sessionScopeKey) return;
    if (!sessionIsNewer(stored.session, sessionPreview || studioDocument.session)) return;
    setStudioDocument((current) => current ? normalizeStudioDocument({ ...current, session: stored.session! }) : current);
  }, [sessionPreview, sessionScopeKey, setStudioDocument, studioDocument]);

  useEffect(() => {
    if (!sessionScopeKey) return;
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== SHARED_BROWSER_SESSION_KEY || !event.newValue) return;
      const stored = parseSharedBrowserSession(event.newValue);
      if (!stored?.session) return;
      if (normalizeSessionScopeKey(stored.session) !== sessionScopeKey) return;
      if (!sessionIsNewer(stored.session, sessionPreview || studioDocument?.session || null)) return;
      setStudioDocument((current) => current ? normalizeStudioDocument({ ...current, session: stored.session! }) : current);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [sessionPreview, sessionScopeKey, setStudioDocument, studioDocument?.session]);

  useEffect(() => {
    if (readerRoute) return;
    if (homeRoute) {
      document.title = `${platformName} · Home`;
      return;
    }
    if (studioRoute) {
      document.title = `${platformName} · Building`;
      return;
    }
    if (helpRoute) {
      document.title = `${platformName} · Help`;
      return;
    }
    if (viewerRoute || location.pathname === "/") {
      document.title = `${platformName} · Viewing`;
      return;
    }
    document.title = platformName;
  }, [helpRoute, homeRoute, location.pathname, platformName, readerRoute, studioRoute, viewerRoute]);

  if (hostedLaunchRequiredMessage || (studioDocument && sessionStatus && !sessionStatus.valid)) {
    return (
      <div className="app-shell">
        <main className="content">
          <div className="empty-page">
            <h1>{sessionStatus?.expired ? "Session expired" : "Launch required"}</h1>
            <p>{hostedLaunchRequiredMessage || sessionStatus?.message}</p>
            {studioDocument ? <p>Last activity: {formatTimestamp(studioDocument.session.lastActivityAt)}</p> : null}
            {studioDocument && sessionStatus ? <p>Expired: {formatTimestamp(sessionStatus.expiresAt)}</p> : null}
            {studioDocument && !hostedLaunchRequiredMessage && studioDocument.session.launchSource === "local-dev" ? (
              <button
                onClick={() => {
                  const nextSession = touchStudioSession(studioDocument.session, {
                    now: Date.now(),
                    relaunch: true,
                    launchSource: "local-dev",
                    currentUserId: studioDocument.session.currentUserId
                  });
                  setStudioDocument((current) => current ? normalizeStudioDocument({ ...current, session: nextSession }) : current);
                  void persistSession(nextSession).catch(() => undefined);
                }}
              >
                Resume local session
              </button>
            ) : null}
            <p className="micro">Production access is only allowed when the URL includes the matching Quickbase realm, app, and user context from the launch button.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={`app-shell ${hosted.embed ? "embed-shell" : ""} ${readerFullScreen ? "reader-shell" : ""}`}>
      {hosted.embed || readerRoute ? null : (
        <header className="topbar">
          <div>
            <div className="eyebrow">{homeRoute ? "Home" : studioRoute ? "Building" : viewerRoute ? "Viewing" : helpRoute ? "Help" : "Viewer"}</div>
            <h1>{platformName}</h1>
          </div>
          <div className="topbar-meta">
            <div className="topbar-nav">
              <NavLink end className={({ isActive }) => `topbar-tab${isActive ? " active" : ""}`} to={buildHostedRoute("/")}>Home</NavLink>
              <NavLink className={({ isActive }) => `topbar-tab${isActive ? " active" : ""}`} to={buildHostedRoute("/studio")}>Building</NavLink>
              <NavLink className={({ isActive }) => `topbar-tab${isActive ? " active" : ""}`} to={buildHostedRoute("/viewer")}>Viewing</NavLink>
            </div>
            {studioRoute ? (
              <>
                <button className="ghost-button topbar-action" onClick={() => setStudioRefreshSignal((value) => value + 1)}>Refresh all</button>
                <button className="ghost-button topbar-action" onClick={() => setStudioSettingsSignal((value) => value + 1)}>Settings</button>
              </>
            ) : null}
            {homeRoute ? (
              <button className="ghost-button topbar-action" onClick={() => setHomeRefreshSignal((value) => value + 1)}>Refresh all</button>
            ) : null}
            {viewerRoute ? (
              <button className="ghost-button topbar-action" onClick={() => setViewerRefreshSignal((value) => value + 1)}>Refresh all</button>
            ) : null}
            {!helpRoute ? <Link className="ghost-button topbar-action" to={buildHostedRoute("/help")}>Help</Link> : null}
            <span className="badge">{hosted.mode === "viewer" ? "Full-screen view" : navLabel}</span>
            <span className="badge brand">{visibleObjects.length} saved views</span>
          </div>
        </header>
      )}

      <div className={`main-layout ${hosted.embed || studioRoute || readerRoute || viewerRoute || homeRoute ? "embed-layout" : ""} ${readerRoute ? "reader-layout" : ""}`}>
        {hideSidebar ? null : (
          <aside className="sidebar">
            <div className="sidebar-head">
              <strong>{navLabel}</strong>
              <span className="micro">Open a report or dashboard directly.</span>
            </div>
            <nav className="nav-list">
              {visibleObjects.map((object) => (
                <Link key={object.id} className="nav-card" to={buildHostedRoute(`/${object.type}/${object.id}`)} target={openLinksInNewTab ? "_blank" : undefined} rel={openLinksInNewTab ? "noreferrer" : undefined}>
                  <span className="badge">{typeLabel(object.type)}</span>
                  <span className="badge">{getStudioObjectScopeLabel(object)}</span>
                  <strong>{object.name}</strong>
                  <span className="micro">{object.folder} · {object.category}</span>
                </Link>
              ))}
            </nav>
          </aside>
        )}

        <main className={`content ${readerRoute ? "reader-content" : ""}`}>
          {catalogLoading && !objects.length && !tables.length && !studioDocument ? (
            <section className="sync-status">
              <strong>Loading platform content</strong>
              <span>Connecting to saved reports, dashboards, and table definitions…</span>
            </section>
          ) : null}
          {catalogError ? (
            <section className="sync-status sync-status-warn">
              <strong>Some content did not load cleanly</strong>
              <span>{catalogError}</span>
            </section>
          ) : null}
          {bootstrapIssues.length ? (
            <section className={`sync-status ${bootstrapIssues.some((profile) => profile.bootstrap.error || !profile.bootstrap.ready) ? "sync-status-warn" : "sync-status-ok"}`}>
              <strong>{bootstrapIssues.some((profile) => profile.bootstrap.error || !profile.bootstrap.ready) ? "Quickbase setup needs attention" : "Quickbase setup updated"}</strong>
              <div className="stack">
                {bootstrapIssues.map((profile) => (
                  <div key={profile.id}>
                    <strong>{profile.label}</strong>
                    <span>{` ${profile.bootstrap.message}`}</span>
                    {profile.bootstrap.missing.length ? <div className="micro">Missing: {profile.bootstrap.missing.join(", ")}</div> : null}
                    {profile.bootstrap.warnings.length ? <div className="micro">Warnings: {profile.bootstrap.warnings.join(", ")}</div> : null}
                    {profile.bootstrap.error ? <div className="micro">Error: {profile.bootstrap.error}</div> : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <Routes>
            <Route path="/" element={<HomePage objects={visibleObjects} studioDocument={displayDocument} recentIds={recentIds} refreshAllSignal={homeRefreshSignal} openLinksInNewTab={openLinksInNewTab} onRefreshComplete={reloadCatalog} onToggleFavorite={toggleFavorite} />} />
            <Route path="/viewer" element={<ViewerPage objects={visibleObjects} studioDocument={displayDocument} recentIds={recentIds} refreshAllSignal={viewerRefreshSignal} openLinksInNewTab={openLinksInNewTab} onRefreshComplete={reloadCatalog} onToggleFavorite={toggleFavorite} />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/studio" element={<StudioPage openSettingsSignal={studioSettingsSignal} refreshAllSignal={studioRefreshSignal} launchContext={hosted} />} />
            <Route path="/studio/:objectId" element={<StudioPage openSettingsSignal={studioSettingsSignal} refreshAllSignal={studioRefreshSignal} launchContext={hosted} />} />
            <Route path="/:type/:objectId" element={<ObjectPage tables={scopedTables} platformName={platformName} studioDocument={displayDocument} launchContext={hosted} openLinksInNewTab={openLinksInNewTab} onObjectViewed={markObjectAsRecent} onUserSettingsChange={updateUserSettings} onToggleFavorite={toggleFavorite} />} />
            <Route path="*" element={<Navigate to={buildHostedRoute("/")} replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
