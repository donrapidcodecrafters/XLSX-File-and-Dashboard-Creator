import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  filterStudioLibraryItems,
  getStudioObjectScopeLabel,
  isStudioItemVisibleToCurrentUser,
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
import { AcceptInvitationPage } from "./components/AcceptInvitationPage";
import { ResetPasswordPage } from "./components/ResetPasswordPage";
import { DataManagementPage } from "./components/DataManagementPage";
import { InactivityWarning } from "./components/InactivityWarning";
import { ScheduledReportsPage } from "./components/ScheduledReportsPage";
import { DashboardView } from "./components/DashboardView";
import { HelpPage } from "./components/HelpPage";
import { HomePage } from "./components/HomePage";
import { LoginPage } from "./components/LoginPage";
import { NavigationSidebar } from "./components/NavigationSidebar";
import { RefreshOverlay } from "./components/RefreshOverlay";
import { ReportView } from "./components/ReportView";
import { RoleManagementPage } from "./components/RoleManagementPage";
import { StudioPage } from "./components/StudioPage";
import { UserManagementPage } from "./components/UserManagementPage";
import { UserSettingsModal } from "./components/UserSettingsModal";
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
import { buildQuickbaseHelpdeskTicketUrl, type QuickbaseTableLinkContext } from "./lib/quickbaseLinks";
import { AuthRequiredError, checkAuth, fetchStudioDocument, fetchStudioRefreshJob, getMyPermissions, getMyProfile, getSessionTtlHours, logoutSession, saveStudioUserSettings, startStudioObjectRefresh, startStudioRefresh, stopImpersonating, updateStudioSession, type PlatformUser } from "./lib/studioApi";
import { useInactivityLogout } from "./hooks/useInactivityLogout";

const SESSION_RECENT_KEY = "studio-session-recent";
const USER_SETTINGS_PERSIST_DELAY_MS = 500;
const SESSION_PERSIST_INTERVAL_MS = 5 * 60_000;
const SHARED_BROWSER_SESSION_KEY = "studio-shared-browser-session-v1";
const SESSION_ACTIVITY_TOUCH_INTERVAL_MS = 60_000;
const CACHED_STUDIO_DOCUMENT_KEY = "hosted-reporting-studio-v2";
const WORKSPACE_REFRESH_SIGNAL_KEY = "hosted-reporting-workspace-refresh-v1";
const WORKSPACE_REFRESH_EVENT = "studio:workspace-updated";
const SHARED_WORKSPACE_SNAPSHOT_KEY = "studio-shared-workspace-snapshot-v1";
const SHARED_WORKSPACE_DIRTY_KEY = "studio-shared-workspace-dirty-v1";

type TerminalRefreshJob = RefreshJobStatus & { status: "complete" | "failed" | "cancelled" };

function isRefreshJobTerminal(job: RefreshJobStatus | null): job is null | TerminalRefreshJob {
  return !job || job.status === "complete" || job.status === "failed" || job.status === "cancelled";
}

function loadCachedStudioDocument() {
  try {
    const raw = window.localStorage.getItem(CACHED_STUDIO_DOCUMENT_KEY);
    return raw ? normalizeStudioDocument(JSON.parse(raw) as StudioDocument) : null;
  } catch {
    return null;
  }
}

function saveCachedStudioDocument(document: StudioDocument | null) {
  if (!document) return;
  try {
    window.localStorage.setItem(CACHED_STUDIO_DOCUMENT_KEY, JSON.stringify(document));
  } catch {}
}

function loadSharedWorkspaceSnapshot() {
  try {
    const raw = window.localStorage.getItem(SHARED_WORKSPACE_SNAPSHOT_KEY);
    return raw ? normalizeStudioDocument(JSON.parse(raw) as StudioDocument) : null;
  } catch {
    return null;
  }
}

function loadSharedWorkspaceDirtyState() {
  try {
    return window.localStorage.getItem(SHARED_WORKSPACE_DIRTY_KEY) === "1";
  } catch {
    return false;
  }
}

function buildCatalogItemsFromDocument(document: StudioDocument): CatalogSummaryItem[] {
  const objects = document.bundle.objects || {};
  const orderedIds = [
    ...(document.bundle.order || []),
    ...Object.keys(objects)
  ].filter((id, index, list) => Boolean(objects[id]) && list.indexOf(id) === index);
  const items: CatalogSummaryItem[] = [];
  orderedIds.forEach((id) => {
    const object = objects[id];
    if (!object) return;
    items.push({
        id: object.id,
        type: object.type,
        schemaVersion: object.schemaVersion,
        name: object.name,
        description: object.description,
        folder: object.folder,
        category: object.category,
        tags: object.tags,
        scope: object.scope,
        createdByUserId: object.createdByUserId,
        ownerUserId: object.ownerUserId,
        sharedUserIds: object.sharedUserIds,
        updatedAt: object.updatedAt
      });
  });
  return items;
}

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
  const [studioDocument, setStudioDocument] = useState<StudioDocument | null>(() => loadCachedStudioDocument());
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const lastPersistedSessionKey = useRef("");
  const lastPersistedSessionAt = useRef(0);
  const lastPersistedUserSettingsKey = useRef("");
  const userSettingsPersistPromise = useRef<Promise<void> | null>(null);
  const queuedUserSettingsPayload = useRef<{
    favorites?: string[];
    recent?: string[];
    personalOverrides?: StudioDocument["personalOverrides"];
  } | null>(null);
  const userSettingsPersistTimer = useRef<number | null>(null);
  const sessionPersistPromise = useRef<Promise<void> | null>(null);
  const queuedSessionPayload = useRef<Partial<StudioDocument["session"]> | null>(null);
  const queuedSessionKey = useRef("");
  const [authState, setAuthState] = useState<"loading" | "unauthenticated" | "authenticated">("loading");
  const [authRequired, setAuthRequired] = useState(true);
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try {
      const raw = window.sessionStorage.getItem(SESSION_RECENT_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  });

  const reloadCatalog = useCallback(async (options: { skipWhenLocalDirty?: boolean } = {}) => {
    setCatalogLoading(true);
    setCatalogError("");
    if (options.skipWhenLocalDirty && loadSharedWorkspaceDirtyState()) {
      const snapshot = loadSharedWorkspaceSnapshot();
      if (snapshot) {
        setStudioDocument(snapshot);
        setObjects(buildCatalogItemsFromDocument(snapshot));
        setTables(snapshot.bundle.tables || []);
        saveCachedStudioDocument(snapshot);
        setCatalogLoading(false);
        return;
      }
    }
    const studioResponse = await fetchStudioDocument().catch((error: unknown) => {
      if (error instanceof AuthRequiredError) {
        setAuthState("unauthenticated");
        setCatalogLoading(false);
      }
      return null;
    });
    if (studioResponse?.document) {
      const normalized = normalizeStudioDocument(studioResponse.document);
      lastPersistedSessionKey.current = JSON.stringify(normalized.session || {});
      lastPersistedSessionAt.current = Date.now();
      setStudioDocument(normalized);
      setObjects(buildCatalogItemsFromDocument(normalized));
      setTables(normalized.bundle.tables || []);
      saveCachedStudioDocument(normalized);
      setCatalogLoading(false);
      return;
    }

    const [catalogResponse, tablesResponse] = await Promise.allSettled([
      fetchCatalog(),
      fetchTables()
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
    if (!studioDocument) {
      const cachedDocument = loadCachedStudioDocument();
      if (cachedDocument) {
        setStudioDocument(cachedDocument);
        setObjects(buildCatalogItemsFromDocument(cachedDocument));
        setTables(cachedDocument.bundle.tables || []);
        setCatalogError("Using the last saved platform snapshot because the hosted studio document did not load cleanly.");
      }
    }
    if (catalogResponse.status === "rejected" || tablesResponse.status === "rejected") {
      setCatalogError("Some platform data took too long to load. The app is using what it could load and you can retry with Refresh all.");
    }
    setCatalogLoading(false);
  }, [studioDocument]);

  const updateUserSettings = useCallback(async (payload: {
    favorites?: string[];
    recent?: string[];
    personalOverrides?: StudioDocument["personalOverrides"];
  }) => {
    setStudioDocument((current) => applyUserSettingsToDocument(current, payload));
    queuedUserSettingsPayload.current = {
      ...(queuedUserSettingsPayload.current || {}),
      ...payload
    };
    if (userSettingsPersistTimer.current) {
      window.clearTimeout(userSettingsPersistTimer.current);
    }
    userSettingsPersistTimer.current = window.setTimeout(() => {
      userSettingsPersistTimer.current = null;
      if (userSettingsPersistPromise.current) return;
      userSettingsPersistPromise.current = (async () => {
        while (queuedUserSettingsPayload.current) {
          const nextPayload = queuedUserSettingsPayload.current;
          queuedUserSettingsPayload.current = null;
          const nextKey = JSON.stringify(nextPayload || {});
          if (nextKey === lastPersistedUserSettingsKey.current) {
            continue;
          }
          const response = await saveStudioUserSettings(nextPayload);
          lastPersistedUserSettingsKey.current = JSON.stringify(response.settings || {});
          setStudioDocument((current) => applyUserSettingsToDocument(current, response.settings || nextPayload));
        }
      })().finally(() => {
        userSettingsPersistPromise.current = null;
      });
    }, USER_SETTINGS_PERSIST_DELAY_MS);
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
        lastPersistedSessionKey.current = JSON.stringify(response.session || {});
        lastPersistedSessionAt.current = Date.now();
        setStudioDocument((current) => applySessionToDocument(current, response.session));
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
    checkAuth().then((result) => {
      setAuthRequired(result.required);
      if (!result.authenticated) {
        setAuthState("unauthenticated");
        setCatalogLoading(false);
      } else {
        setAuthState("authenticated");
        void reloadCatalog();
      }
    }).catch(() => {
      setAuthRequired(false);
      setAuthState("authenticated");
      void reloadCatalog();
    });
  }, []);

  useEffect(() => {
    saveCachedStudioDocument(studioDocument);
  }, [studioDocument]);

  useEffect(() => {
    const handleWorkspaceUpdated = () => {
      const snapshot = loadSharedWorkspaceSnapshot();
      if (snapshot) {
        setStudioDocument(snapshot);
        setObjects(buildCatalogItemsFromDocument(snapshot));
        setTables(snapshot.bundle.tables || []);
        saveCachedStudioDocument(snapshot);
        return;
      }
      void reloadCatalog();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== WORKSPACE_REFRESH_SIGNAL_KEY) return;
      const snapshot = loadSharedWorkspaceSnapshot();
      if (snapshot) {
        setStudioDocument(snapshot);
        setObjects(buildCatalogItemsFromDocument(snapshot));
        setTables(snapshot.bundle.tables || []);
        saveCachedStudioDocument(snapshot);
        return;
      }
      void reloadCatalog();
    };
    window.addEventListener(WORKSPACE_REFRESH_EVENT, handleWorkspaceUpdated);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(WORKSPACE_REFRESH_EVENT, handleWorkspaceUpdated);
      window.removeEventListener("storage", handleStorage);
    };
  }, [reloadCatalog]);

  return { objects, tables, studioDocument, recentIds, reloadCatalog, markObjectAsRecent, updateUserSettings, persistSession, setStudioDocument, catalogLoading, catalogError, authState, setAuthState, authRequired };
}

function formatTimestamp(value?: string) {
  if (!value) return "Not available yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function sessionsMatch(left: StudioDocument["session"] | null | undefined, right: StudioDocument["session"] | null | undefined) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

function applySessionToDocument(document: StudioDocument | null, session: StudioDocument["session"]) {
  if (!document || sessionsMatch(document.session, session)) return document;
  return {
    ...document,
    session
  };
}

function applyUserSettingsToDocument(
  document: StudioDocument | null,
  payload: {
    favorites?: string[];
    recent?: string[];
    personalOverrides?: StudioDocument["personalOverrides"];
  }
) {
  if (!document) return document;
  return normalizeStudioDocument({
    ...document,
    favorites: payload.favorites ?? document.favorites,
    recent: payload.recent ?? document.recent,
    personalOverrides: payload.personalOverrides ?? document.personalOverrides
  });
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
  onRefreshComplete,
  onUserSettingsChange,
  onToggleFavorite
}: {
  tables: TableDefinition[];
  platformName: string;
  studioDocument: StudioDocument | null;
  launchContext: ReturnType<typeof getHostedContext>;
  openLinksInNewTab?: boolean;
  onObjectViewed: (objectId: string) => void;
  onRefreshComplete: (options?: { skipWhenLocalDirty?: boolean }) => Promise<void>;
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
  const [resultError, setResultError] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [refreshJob, setRefreshJob] = useState<RefreshJobStatus | null>(null);
  const [startingRefresh, setStartingRefresh] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState("");
  const pageSize = 100;
  const scopedObjectFromDocument = useMemo(
    () => params.objectId && studioDocument ? studioDocument.bundle.objects[params.objectId] || null : null,
    [params.objectId, studioDocument]
  );
  const scopedObjectVersion = useMemo(
    () => scopedObjectFromDocument
      ? `${scopedObjectFromDocument.id}:${scopedObjectFromDocument.updatedAt}:${scopedObjectFromDocument.type}`
      : "",
    [scopedObjectFromDocument]
  );
  const liveModeEnabled = useMemo(
    () => getProfileIdsForObject(object, tables, studioDocument)
      .some((profileId) => studioDocument?.quickbaseProfiles.find((profile) => profile.id === profileId)?.liveMode === true),
    [object, studioDocument, tables]
  );
  const reportDefinitions = useMemo(
    () =>
      Object.fromEntries(
        Object.values(studioDocument?.bundle.objects || {})
          .filter((item): item is ReportDefinition => item?.type === "report")
          .map((report) => [report.id, report])
      ),
    [studioDocument]
  );
  const dashboardPersonalOverride = object?.type === "dashboard" && object.scope !== "personal"
    ? getDashboardPersonalOverride(object.id, studioDocument)
    : null;

  async function fetchObjectWithFallback(targetObjectId: string) {
    try {
      return (await fetchObject(targetObjectId)).object;
    } catch (primaryError) {
      const fallbackDocument = await fetchStudioDocument().catch(() => null);
      const fallbackObject = fallbackDocument?.document?.bundle?.objects?.[targetObjectId] || null;
      if (fallbackObject) {
        return fallbackObject;
      }
      throw primaryError;
    }
  }

  useEffect(() => {
    if (!params.objectId) return;
    if (scopedObjectFromDocument) {
      const isSameObject = object?.id === scopedObjectFromDocument.id;
      const reportOverride = scopedObjectFromDocument.type === "report" && scopedObjectFromDocument.scope !== "personal"
        ? getReportPersonalOverride(scopedObjectFromDocument.id, studioDocument)
        : null;
      setPage(reportOverride?.currentPage || 1);
      setObject(scopedObjectFromDocument);
      setRefreshNotice("");
      if (!isSameObject) {
        setResult(null);
        setResultError("");
        setRefreshNonce(0);
        setRefreshJob(null);
        onObjectViewed(scopedObjectFromDocument.id);
      }
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setRefreshNonce(0);
    setRefreshJob(null);
    setResultError("");
    setRefreshNotice("");
    fetchObjectWithFallback(params.objectId)
      .then((nextObject) => {
        if (!active) return;
        const isSameObject = object?.id === nextObject.id;
        const reportOverride = nextObject.type === "report" && nextObject.scope !== "personal"
          ? getReportPersonalOverride(nextObject.id, studioDocument)
          : null;
        setPage(reportOverride?.currentPage || 1);
        setObject(nextObject);
        if (!isSameObject) {
          setResult(null);
          setResultError("");
          onObjectViewed(nextObject.id);
        }
      })
      .catch((error) => {
        if (!active) return;
        setResultError(error instanceof Error ? error.message : "That report or dashboard could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [object?.id, onObjectViewed, params.objectId, scopedObjectFromDocument, scopedObjectVersion, studioDocument]);

  useEffect(() => {
    if (object) {
      document.title = object.name + " · " + platformName;
    }
  }, [object, platformName]);

  useEffect(() => {
    if (!object || object.type !== "report" || object.scope === "personal") return;
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
    setResultError("");
    const fetcher = page === 1
      ? runReport(object.id, [], { forceLive: liveModeEnabled, report: object })
      : runReportPage(object.id, page, pageSize, [], { forceLive: liveModeEnabled, report: object });
    fetcher
      .then((reportResult) => {
        if (!active) return;
        setResultError("");
        setRefreshNotice("");
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
      .catch((error) => {
        if (!active) return;
        setResultError(error instanceof Error ? error.message : "Report results could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [liveModeEnabled, object?.id, object?.type, page, refreshNonce]);

  useEffect(() => {
    if (isRefreshJobTerminal(refreshJob)) return;
    const handle = window.setInterval(() => {
      fetchStudioRefreshJob(refreshJob.id)
        .then(async (response) => {
          setRefreshJob(response.job);
          if (response.job.status === "complete") {
            setRefreshJob({ ...response.job, status: "running", progress: 99, message: "Loading refreshed data…" });
            await onRefreshComplete({ skipWhenLocalDirty: true }).catch(() => undefined);
            setRefreshNotice("");
            setRefreshNonce((current) => current + 1);
            setLoading(true);
            setRefreshJob(null);
          } else if (response.job.status === "cancelled") {
            setRefreshNotice(response.job.message || "Refresh cancelled.");
            setLoading(false);
          } else if (response.job.status === "failed") {
            setRefreshNotice(response.job.error || response.job.message || "Refresh failed.");
            setLoading(false);
          }
        })
        .catch((error) => {
          setRefreshJob((current) => current && current.id === refreshJob.id && !isRefreshJobTerminal(current)
            ? {
                ...current,
                message: error instanceof Error
                  ? `Refresh is still running, but status polling failed: ${error.message}`
                  : "Refresh is still running, but status polling failed."
              }
            : current);
        });
    }, 1000);
    return () => window.clearInterval(handle);
  }, [onRefreshComplete, refreshJob]);

  async function startObjectRefresh() {
    if (!object) return;
    setStartingRefresh(true);
    setRefreshNotice("");
    try {
      const response = await startStudioObjectRefresh(object.id);
      setRefreshJob(response.job);
      if (response.job.status === "complete") {
        setRefreshJob({ ...response.job, status: "running", progress: 99, message: "Loading refreshed data…" });
        await onRefreshComplete({ skipWhenLocalDirty: true }).catch(() => undefined);
        setRefreshNotice("");
        setRefreshNonce((current) => current + 1);
        setLoading(true);
        setRefreshJob(null);
      } else if (response.job.status === "failed" || response.job.status === "cancelled") {
        setRefreshNotice(response.job.error || response.job.message || "Refresh did not start.");
      }
    } finally {
      window.setTimeout(() => setStartingRefresh(false), 700);
    }
  }

  if (!params.objectId) return null;
  if (!object && loading) return <div className="empty-page">Loading report or dashboard…</div>;
  if (!object) return <div className="empty-page">That report or dashboard could not be found.</div>;
  if (!isObjectInLaunchScope(object, tables, studioDocument, launchContext)) {
    return <div className="empty-page">That report or dashboard is not available for this Quickbase realm and app.</div>;
  }
  if (!isStudioItemVisibleToCurrentUser(object, studioDocument?.session.currentUserId || "")) {
    return <div className="empty-page">That report or dashboard is not available for this session.</div>;
  }

  if (object.type === "report") {
    const table = resolveTableDefinition(tables, object.sourceTableId);
    const quickbaseLinkContext = getQuickbaseLinkContextForTable(table, studioDocument);
    const personalOverride = object.scope !== "personal" ? getReportPersonalOverride(object.id, studioDocument) : null;
    return (
      <>
        {startingRefresh && !refreshJob ? (
          <RefreshOverlay title="Starting report refresh" indeterminate job={{ message: "Starting a cache refresh for this report…" }} />
        ) : null}
        {liveModeEnabled ? (
          <div className="sync-status sync-status-warn">
            <strong>Live mode enabled</strong>
            <span>This report is loading live Quickbase data directly, so loading can take significantly longer.</span>
          </div>
        ) : null}
        {refreshNotice ? (
          <div className="sync-status sync-status-warn">
            <strong>Refresh needs attention</strong>
            <span>{refreshNotice}</span>
          </div>
        ) : null}
        {refreshJob ? (
          <RefreshOverlay title={refreshJob.status === "complete" ? "Report refresh complete" : refreshJob.status === "failed" ? "Report refresh failed" : refreshJob.status === "cancelled" ? "Report refresh cancelled" : "Refreshing this report"} job={refreshJob} status={refreshJob.status} onDismiss={() => setRefreshJob(null)} />
        ) : null}
        <ReportView
          report={object as ReportDefinition}
          table={table}
          quickbaseLinkContext={quickbaseLinkContext}
          result={result}
          loadError={resultError}
          loading={loading}
          currentPage={page}
          onPageChange={setPage}
          onRefresh={() => { void startObjectRefresh(); }}
          initialFocusMode={(personalOverride?.focusMode || "default") as ReportFocusMode}
          initialFocusedSection={personalOverride?.focusedSection || ""}
          savedViews={personalOverride?.savedViews || []}
          onSaveView={(view) => {
            if (object.scope === "personal" || !studioDocument) return;
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
            if (object.scope === "personal" || !studioDocument) return;
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
            if (object.scope === "personal" || !studioDocument) return;
            const currentPage = Math.max(1, state.currentPage || 1);
            const currentFocusMode = state.focusMode;
            const currentFocusedSection = state.focusedSection;
            if (
              Math.max(1, personalOverride?.currentPage || 1) === currentPage
              && (personalOverride?.focusMode || "default") === currentFocusMode
              && (personalOverride?.focusedSection || "") === currentFocusedSection
            ) {
              return;
            }
            const nextPersonalOverrides: StudioDocument["personalOverrides"] = {
              ...studioDocument.personalOverrides,
              reports: {
                ...studioDocument.personalOverrides.reports,
                [object.id]: {
                  currentPage,
                  focusMode: currentFocusMode,
                  focusedSection: currentFocusedSection,
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

  return (
    <>
      {startingRefresh && !refreshJob ? (
        <RefreshOverlay title="Starting dashboard refresh" indeterminate job={{ message: "Starting a cache refresh for this dashboard…" }} />
      ) : null}
      {liveModeEnabled ? (
        <div className="sync-status sync-status-warn">
          <strong>Live mode enabled</strong>
          <span>This dashboard is loading live Quickbase data directly, so loading can take significantly longer.</span>
        </div>
      ) : null}
      {refreshNotice ? (
        <div className="sync-status sync-status-warn">
          <strong>Refresh needs attention</strong>
          <span>{refreshNotice}</span>
        </div>
      ) : null}
      {refreshJob ? (
        <RefreshOverlay title={refreshJob.status === "complete" ? "Dashboard refresh complete" : refreshJob.status === "failed" ? "Dashboard refresh failed" : refreshJob.status === "cancelled" ? "Dashboard refresh cancelled" : "Refreshing this dashboard"} job={refreshJob} status={refreshJob.status} onDismiss={() => setRefreshJob(null)} />
      ) : null}
      <DashboardView
        dashboard={object}
        reportDefinitions={reportDefinitions}
        tables={tables}
        getQuickbaseLinkContext={(tableId) => getQuickbaseLinkContextForTable(resolveTableDefinition(tables, tableId), studioDocument)}
        refreshNonce={refreshNonce}
        onRefresh={() => { void startObjectRefresh(); }}
        initialRuntimeFilters={dashboardPersonalOverride?.runtimeFilters}
        initialActiveTabId={dashboardPersonalOverride?.activeTabId}
        initialFocusedWidgetId={dashboardPersonalOverride?.focusedWidgetId}
        savedViews={dashboardPersonalOverride?.savedViews || []}
        onSaveView={(view) => {
          if (object.scope === "personal" || !studioDocument) return;
          const nextPersonalOverrides: StudioDocument["personalOverrides"] = {
            ...studioDocument.personalOverrides,
            dashboards: {
              ...studioDocument.personalOverrides.dashboards,
              [object.id]: {
                runtimeFilters: dashboardPersonalOverride?.runtimeFilters || {},
                activeTabId: dashboardPersonalOverride?.activeTabId || "",
                focusedWidgetId: dashboardPersonalOverride?.focusedWidgetId || "",
                savedViews: [...(dashboardPersonalOverride?.savedViews || []), { ...view, updatedAt: new Date().toISOString() }],
                updatedAt: new Date().toISOString()
              }
            }
          };
          void onUserSettingsChange({ personalOverrides: nextPersonalOverrides });
        }}
        onDeleteView={(viewId) => {
          if (object.scope === "personal" || !studioDocument) return;
          const nextPersonalOverrides: StudioDocument["personalOverrides"] = {
            ...studioDocument.personalOverrides,
            dashboards: {
              ...studioDocument.personalOverrides.dashboards,
              [object.id]: {
                runtimeFilters: dashboardPersonalOverride?.runtimeFilters || {},
                activeTabId: dashboardPersonalOverride?.activeTabId || "",
                focusedWidgetId: dashboardPersonalOverride?.focusedWidgetId || "",
                savedViews: (dashboardPersonalOverride?.savedViews || []).filter((view) => view.id !== viewId),
                updatedAt: new Date().toISOString()
              }
            }
          };
          void onUserSettingsChange({ personalOverrides: nextPersonalOverrides });
        }}
        isFavorite={(studioDocument?.favorites || []).includes(object.id)}
        onToggleFavorite={() => { void onToggleFavorite(object.id); }}
        onStateChange={(state) => {
          if (object.scope === "personal" || !studioDocument) return;
          const currentRuntimeFilters = state.runtimeFilters || {};
          const currentActiveTabId = state.activeTabId || "";
          const currentFocusedWidgetId = state.focusedWidgetId || "";
          if (
            JSON.stringify(dashboardPersonalOverride?.runtimeFilters || {}) === JSON.stringify(currentRuntimeFilters)
            && (dashboardPersonalOverride?.activeTabId || "") === currentActiveTabId
            && (dashboardPersonalOverride?.focusedWidgetId || "") === currentFocusedWidgetId
          ) {
            return;
          }
          const nextPersonalOverrides: StudioDocument["personalOverrides"] = {
            ...studioDocument.personalOverrides,
            dashboards: {
              ...studioDocument.personalOverrides.dashboards,
              [object.id]: {
                runtimeFilters: currentRuntimeFilters,
                activeTabId: currentActiveTabId,
                focusedWidgetId: currentFocusedWidgetId,
                savedViews: dashboardPersonalOverride?.savedViews || [],
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

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    try { return window.localStorage.getItem('theme') === 'dark'; } catch { return false; }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (dark) { root.classList.add('dark'); } else { root.classList.remove('dark'); }
    try { window.localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch {}
  }, [dark]);
  return [dark, setDark] as const;
}

export function App() {
  const { objects, tables, studioDocument, recentIds, reloadCatalog, markObjectAsRecent, updateUserSettings, persistSession, setStudioDocument, catalogLoading, catalogError, authState, setAuthState, authRequired } = useCatalog();
  const [isDark, setIsDark] = useDarkMode();
  const [currentUser, setCurrentUser] = useState<PlatformUser | null>(null);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [sidebarPinned, setSidebarPinned] = useState<boolean>(() => {
    try { return window.localStorage.getItem("sidebar-pinned") === "true"; } catch { return false; }
  });
  // Effective permission map — all keys true for developer/admin/no-auth, granular for others
  const [userPermissions, setUserPermissions] = useState<Record<string, boolean>>({});
  // Session TTL (hours) for the inactivity auto-logout timer
  const [sessionTtlHours, setSessionTtlHours] = useState(24);
  const location = useLocation();
  const navigate = useNavigate();
  const isDeveloperUser = currentUser?.email === "don@rapidcodecrafters.com";
  const isAdminOrDev = !authRequired || currentUser?.role === "admin" || currentUser?.role === "developer" || isDeveloperUser;

  // Helper: check a permission — when auth is off or user is admin/dev, everything is allowed
  function hasPerm(key: string): boolean {
    if (!authRequired || isAdminOrDev) return true;
    return userPermissions[key] === true;
  }

  // Load current user profile + permissions + session TTL when authenticated
  useEffect(() => {
    if (authState !== "authenticated") return;
    getMyProfile().then((r) => {
      setCurrentUser(r.user);
      const theme = r.user.theme || "system";
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const useDark = theme === "dark" || (theme === "system" && prefersDark);
      setIsDark(useDark);
    }).catch(() => {});
    getMyPermissions().then((r) => {
      setUserPermissions(r.permissions || {});
    }).catch(() => {});
    getSessionTtlHours().then(setSessionTtlHours).catch(() => {});
  }, [authState]);

  // Close user menu on outside click
  useEffect(() => {
    if (!userMenuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [userMenuOpen]);

  // Inactivity auto-logout
  const doLogout = useCallback(() => {
    void logoutSession().finally(() => {
      setAuthState("unauthenticated");
      setCurrentUser(null);
    });
  }, [setAuthState]);

  const { showWarning: showInactivityWarning, secondsLeft, staySignedIn } = useInactivityLogout({
    ttlHours: sessionTtlHours,
    onTimeout: doLogout,
    enabled: authState === "authenticated" && authRequired,
  });
  const hosted = useMemo(() => getHostedContext(), [location.key]);
  const lastSessionTouchAt = useRef(0);
  const sessionTouchTimeoutRef = useRef<number | null>(null);
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
      ? applySessionToDocument(studioDocument, sessionPreview)
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
  const requiresHostedStudioDocument = hosted.launchSource === "quickbase-button";
  const catalogSourceObjects = useMemo(
    () => displayDocument
      ? displayDocument.bundle.order
          .map((id) => displayDocument.bundle.objects[id])
          .filter((object): object is StudioObject => Boolean(object))
          .map((object) => ({
            id: object.id,
            type: object.type,
            schemaVersion: object.schemaVersion,
            name: object.name,
            description: object.description,
            folder: object.folder,
            category: object.category,
            tags: object.tags,
            scope: object.scope,
            ownerUserId: object.ownerUserId,
            sharedUserIds: object.sharedUserIds,
            updatedAt: object.updatedAt
          }))
      : requiresHostedStudioDocument ? [] : objects,
    [displayDocument, objects, requiresHostedStudioDocument]
  );
  const scopedTables = useMemo(
    () => {
      if (requiresHostedStudioDocument && !sessionScopedDocument) return [];
      const sourceTables = displayDocument?.bundle.tables?.length
        ? displayDocument.bundle.tables
        : tables;
      return filterTablesForLaunchScope(sourceTables, sessionScopedDocument, {
        launchSource: hosted.launchSource,
        currentUserId,
        launchRealmHostname: hosted.realmHostname,
        launchAppId: hosted.appId
      });
    },
    [currentUserId, displayDocument, hosted.appId, hosted.launchSource, hosted.realmHostname, requiresHostedStudioDocument, sessionScopedDocument, tables]
  );
  const bootstrapIssues = useMemo(
    () => (displayDocument?.quickbaseProfiles || []).filter((profile) => !profile.bootstrap.ready || profile.bootstrap.autoProvisioned || profile.bootstrap.error),
    [displayDocument]
  );
  const activeQuickbaseProfile = useMemo(() => {
    const sourceDocument = displayDocument || studioDocument;
    if (!sourceDocument) return null;
    const launchedAppId = String(hosted.appId || "").trim().toLowerCase();
    if (launchedAppId) {
      const launchedProfile = sourceDocument.quickbaseProfiles.find((profile) => String(profile.quickbase.appId || "").trim().toLowerCase() === launchedAppId);
      if (launchedProfile) return launchedProfile;
    }
    return sourceDocument.quickbaseProfiles.find((profile) => profile.id === sourceDocument.activeQuickbaseProfileId) || sourceDocument.quickbaseProfiles[0] || null;
  }, [displayDocument, hosted.appId, studioDocument]);
  const helpdeskTicketUrl = useMemo(() => {
    const sourceDocument = displayDocument || studioDocument;
    const quickbaseConfig = activeQuickbaseProfile?.quickbase || sourceDocument?.quickbase;
    const currentAppId = String(hosted.appId || quickbaseConfig?.appId || "").trim();
    if (!quickbaseConfig) return "";
    return buildQuickbaseHelpdeskTicketUrl({
      ...quickbaseConfig,
      realmHostname: hosted.realmHostname || quickbaseConfig.realmHostname
    }, currentAppId);
  }, [activeQuickbaseProfile, displayDocument, hosted.appId, hosted.realmHostname, studioDocument]);
  const visibleObjects = useMemo(
    () => filterStudioLibraryItems(
      displayDocument
        ? catalogSourceObjects
        : requiresHostedStudioDocument
          ? []
        : catalogSourceObjects.filter((item) => isCatalogItemInLaunchScope(item, sessionScopedDocument, {
            launchSource: hosted.launchSource,
            currentUserId,
            launchRealmHostname: hosted.realmHostname,
            launchAppId: hosted.appId
          })),
      { currentUserId }
    ),
    [catalogSourceObjects, currentUserId, displayDocument, hosted.appId, hosted.launchSource, hosted.realmHostname, requiresHostedStudioDocument, sessionScopedDocument]
  );
  const [studioSettingsSignal, setStudioSettingsSignal] = useState(0);
  const [topbarRefreshJob, setTopbarRefreshJob] = useState<RefreshJobStatus | null>(null);
  const [topbarStartingRefresh, setTopbarStartingRefresh] = useState(false);
  const [topbarRefreshFeedback, setTopbarRefreshFeedback] = useState<{ tone: "warn" | "danger"; message: string } | null>(null);
  const lastAppliedLaunchSessionKey = useRef("");
  const homeRoute = location.pathname === "/";
  const helpRoute = location.pathname === "/help";
  const studioRoute = location.pathname.startsWith("/studio");
  const viewerRoute = location.pathname === "/viewer";
  const readerRoute = /^\/(report|dashboard)\//.test(location.pathname);
  const platformName = studioDocument?.branding.platformName || "Reporting Portal";
  const openLinksInNewTab = studioDocument?.branding.openLinksInNewTab === true;
  const navLabel = studioDocument?.branding.navigationLabel || "Reports and Dashboards";
  const readerFullScreen = readerRoute || hosted.mode === "viewer" || hosted.embed;
  const toggleFavorite = useCallback(async (objectId: string) => {
    if (!studioDocument) return;
    const next = toggleFavoriteIds(studioDocument.favorites || [], objectId);
    await updateUserSettings({ favorites: next });
  }, [studioDocument, updateUserSettings]);

  useEffect(() => {
    if (isRefreshJobTerminal(topbarRefreshJob)) return;
    const handle = window.setInterval(() => {
      fetchStudioRefreshJob(topbarRefreshJob.id)
        .then(async (response) => {
          setTopbarRefreshJob(response.job);
          if (response.job.status === "complete") {
            setTopbarRefreshFeedback(null);
            setTopbarRefreshJob({ ...response.job, status: "running", progress: 99, message: "Loading refreshed data…" });
            await reloadCatalog({ skipWhenLocalDirty: true });
            setTopbarRefreshJob(null);
          } else if (response.job.status === "failed") {
            setTopbarRefreshFeedback({
              tone: "danger",
              message: response.job.error || response.job.message || "Refresh failed."
            });
          } else if (response.job.status === "cancelled") {
            setTopbarRefreshFeedback({
              tone: "warn",
              message: response.job.message || "Refresh cancelled."
            });
          }
        })
        .catch((error) => {
          setTopbarRefreshJob((current) => current && current.id === topbarRefreshJob.id && !isRefreshJobTerminal(current)
            ? {
                ...current,
                message: error instanceof Error
                  ? `Refresh is still running, but status polling failed: ${error.message}`
                  : "Refresh is still running, but status polling failed."
              }
            : current);
          setTopbarRefreshFeedback({
            tone: "warn",
            message: error instanceof Error ? error.message : "Unable to fetch refresh status. Retrying..."
          });
        });
    }, 1000);
    return () => window.clearInterval(handle);
  }, [reloadCatalog, topbarRefreshJob]);

  async function startTopbarRefresh() {
    setTopbarStartingRefresh(true);
    setTopbarRefreshFeedback(null);
    try {
      const response = await startStudioRefresh(activeQuickbaseProfile?.id || "");
      setTopbarRefreshJob(response.job);
      if (response.job.status === "complete") {
        setTopbarRefreshFeedback(null);
        setTopbarRefreshJob({ ...response.job, status: "running", progress: 99, message: "Loading refreshed data…" });
        await reloadCatalog({ skipWhenLocalDirty: true });
        setTopbarRefreshJob(null);
      } else if (response.job.status === "failed") {
        setTopbarRefreshFeedback({
          tone: "danger",
          message: response.job.error || response.job.message || "Refresh failed."
        });
      } else if (response.job.status === "cancelled") {
        setTopbarRefreshFeedback({
          tone: "warn",
          message: response.job.message || "Refresh cancelled."
        });
      }
    } catch (error) {
      setTopbarRefreshFeedback({
        tone: "danger",
        message: error instanceof Error ? error.message : "Refresh failed to start."
      });
    } finally {
      window.setTimeout(() => setTopbarStartingRefresh(false), 700);
    }
  }

  function openHelpdeskTicket() {
    if (!helpdeskTicketUrl) return;
    const popup = window.open(
      helpdeskTicketUrl,
      `studio-helpdesk-${activeQuickbaseProfile?.quickbase.helpdeskAppDbid || "ticket"}`,
      "popup=yes,width=1320,height=900,resizable=yes,scrollbars=yes"
    );
    popup?.focus();
  }

  useEffect(() => {
    if (!studioDocument || !hosted.launchSource) return;
    const launchSessionKey = JSON.stringify({
      launchSource: hosted.launchSource,
      currentUserId: hosted.userId || studioDocument.session.currentUserId,
      launchRealmHostname: hosted.realmHostname,
      launchAppId: hosted.appId
    });
    if (launchSessionKey === lastAppliedLaunchSessionKey.current) return;
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
    lastAppliedLaunchSessionKey.current = launchSessionKey;
    setStudioDocument((current) => applySessionToDocument(current, nextSession));
    void persistSession(nextSession).catch(() => undefined);
  }, [hosted.appId, hosted.launchSource, hosted.realmHostname, hosted.userId, persistSession, setStudioDocument, studioDocument]);

  useEffect(() => {
    if (!studioDocument || !sessionStatus?.valid || authState !== "authenticated") return;
    const touch = () => {
      const now = Date.now();
      if (now - lastSessionTouchAt.current < SESSION_ACTIVITY_TOUCH_INTERVAL_MS) return;
      lastSessionTouchAt.current = now;
      const nextSession = touchStudioSession(sessionPreview || studioDocument.session, { now });
      setStudioDocument((current) => applySessionToDocument(current, nextSession));
      void persistSession(nextSession).catch(() => undefined);
    };
    const scheduleTouch = () => {
      if (sessionTouchTimeoutRef.current !== null) return;
      sessionTouchTimeoutRef.current = window.setTimeout(() => {
        sessionTouchTimeoutRef.current = null;
        touch();
      }, 0);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") scheduleTouch();
    };
    // Use post-action events so session touches do not steal or cancel real button clicks.
    window.addEventListener("click", scheduleTouch);
    window.addEventListener("keyup", scheduleTouch);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      if (sessionTouchTimeoutRef.current !== null) {
        window.clearTimeout(sessionTouchTimeoutRef.current);
        sessionTouchTimeoutRef.current = null;
      }
      window.removeEventListener("click", scheduleTouch);
      window.removeEventListener("keyup", scheduleTouch);
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
    setStudioDocument((current) => applySessionToDocument(current, stored.session!));
  }, [sessionPreview, sessionScopeKey, setStudioDocument, studioDocument]);

  useEffect(() => {
    if (!sessionScopeKey) return;
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== SHARED_BROWSER_SESSION_KEY || !event.newValue) return;
      const stored = parseSharedBrowserSession(event.newValue);
      if (!stored?.session) return;
      if (normalizeSessionScopeKey(stored.session) !== sessionScopeKey) return;
      if (!sessionIsNewer(stored.session, sessionPreview || studioDocument?.session || null)) return;
      setStudioDocument((current) => applySessionToDocument(current, stored.session!));
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

  // Public pages — use window.location (not React Router's location) because
  // the Apache SPA rewrite can cause useLocation() to return "/" instead of the real path.
  const rawPath = window.location.pathname;
  if (rawPath.startsWith("/accept-invitation/")) {
    return <AcceptInvitationPage />;
  }
  if (rawPath.startsWith("/reset-password/")) {
    return <ResetPasswordPage />;
  }

  if (authState === "loading") {
    return (
      <div className="app-shell">
        <main className="content">
          <div className="empty-page">Loading…</div>
        </main>
      </div>
    );
  }

  if (authState === "unauthenticated") {
    return (
      <LoginPage
        platformName={studioDocument?.branding.platformName || "Reporting Portal"}
        onLoginSuccess={() => {
          setAuthState("authenticated");
          void reloadCatalog();
        }}
      />
    );
  }


  // Skip Quickbase session validation when user is authenticated via the platform's own auth system
  const skipQuickbaseSessionCheck = authRequired ? authState === "authenticated" : true;
  if (!skipQuickbaseSessionCheck && (hostedLaunchRequiredMessage || (studioDocument && sessionStatus && !sessionStatus.valid))) {
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
      {/* Inactivity warning — rendered above everything else */}
      {showInactivityWarning && (
        <InactivityWarning
          secondsLeft={secondsLeft}
          onStay={staySignedIn}
          onLogout={doLogout}
        />
      )}
      {topbarStartingRefresh && !topbarRefreshJob ? (
        <RefreshOverlay title="Starting refresh" indeterminate job={{ message: "Starting a full platform refresh…" }} />
      ) : null}
      {topbarRefreshJob ? (
        <RefreshOverlay title={topbarRefreshJob.status === "complete" ? "Refresh complete" : topbarRefreshJob.status === "failed" ? "Refresh failed" : topbarRefreshJob.status === "cancelled" ? "Refresh cancelled" : "Refreshing all reports and dashboards"} job={topbarRefreshJob} status={topbarRefreshJob.status} onDismiss={() => setTopbarRefreshJob(null)} />
      ) : null}
      {topbarRefreshFeedback ? (
        <section className="sync-status sync-status-warn">
          <strong>{topbarRefreshFeedback.tone === "danger" ? "Refresh failed" : "Refresh stopped"}</strong>
          <span>{topbarRefreshFeedback.message}</span>
        </section>
      ) : null}
      <NavigationSidebar
        currentUser={currentUser}
        onSignOut={() => { void logoutSession().finally(() => setAuthState("unauthenticated")); }}
        onOpenSettings={() => setShowUserSettings(true)}
        onPinnedChange={setSidebarPinned}
        objects={visibleObjects}
        authRequired={authRequired}
        permissions={userPermissions}
      />
      <div className={`app-content-with-sidebar${sidebarPinned ? " sidebar-pinned" : ""}`}>
      {hosted.embed || readerRoute ? null : (
        <header className="topbar">
          <div className="topbar-brand">
            <div className="eyebrow">{homeRoute ? "Home" : studioRoute ? "Building" : viewerRoute ? "Viewing" : helpRoute ? "Help" : "Viewer"}</div>
            <h1>{platformName}</h1>
          </div>
          <div className="topbar-meta">
            <div className="topbar-nav">
              <NavLink end className={({ isActive }) => `topbar-tab${isActive ? " active" : ""}`} to={buildHostedRoute("/")}>Home</NavLink>
              <NavLink className={({ isActive }) => `topbar-tab${isActive ? " active" : ""}`} to={buildHostedRoute("/studio")}>Building</NavLink>
              <NavLink className={({ isActive }) => `topbar-tab${isActive ? " active" : ""}`} to={buildHostedRoute("/viewer")}>Viewing</NavLink>
            </div>
            {(homeRoute || viewerRoute) ? (
              <button className="ghost-button topbar-action btn-system" onClick={() => { void startTopbarRefresh(); }}>Refresh all</button>
            ) : null}
            {studioRoute ? (
              <>
                <button className="ghost-button topbar-action btn-system" onClick={() => { void startTopbarRefresh(); }}>Refresh all</button>
                <button className="ghost-button topbar-action btn-system" onClick={() => navigate("/settings")}>Settings</button>
              </>
            ) : null}
          </div>
          {/* User dropdown — must be outside topbar-meta (overflow:hidden) so dropdown isn't clipped */}
          <div className="topbar-user-menu" ref={userMenuRef}>
              <button
                className="ghost-button topbar-action topbar-user-trigger"
                onClick={() => setUserMenuOpen((o) => !o)}
                title={currentUser ? `${currentUser.displayName || currentUser.email} — Account options` : "Account options"}
              >
                <span className="topbar-avatar">
                  {currentUser ? (currentUser.displayName || currentUser.email).charAt(0).toUpperCase() : "?"}
                </span>
                <span className="topbar-username">
                  {currentUser ? (currentUser.displayName || currentUser.email.split("@")[0]) : "Account"}
                </span>
                <span className="topbar-chevron">{userMenuOpen ? "▴" : "▾"}</span>
              </button>
              {userMenuOpen && (
                <div className="topbar-user-dropdown">
                  <button className="topbar-dropdown-item" onClick={() => { setShowUserSettings(true); setUserMenuOpen(false); }}>
                    Account settings
                  </button>
                  <button className="topbar-dropdown-item" onClick={() => { setIsDark((d) => !d); setUserMenuOpen(false); }}>
                    {isDark ? "Light mode" : "Dark mode"}
                  </button>
                  {!helpRoute ? (
                    <button className="topbar-dropdown-item" onClick={() => { navigate(buildHostedRoute("/help")); setUserMenuOpen(false); }}>
                      Help guide
                    </button>
                  ) : null}
                  {helpdeskTicketUrl ? (
                    <button className="topbar-dropdown-item" onClick={() => { openHelpdeskTicket(); setUserMenuOpen(false); }}>
                      Help ticket
                    </button>
                  ) : null}
                  {isAdminOrDev ? (
                    <button className="topbar-dropdown-item" onClick={() => { navigate(buildHostedRoute("/users")); setUserMenuOpen(false); }}>
                      Users
                    </button>
                  ) : null}
                  <div className="topbar-dropdown-divider" />
                  <button
                    className="topbar-dropdown-item topbar-dropdown-danger"
                    onClick={() => { void logoutSession().finally(() => setAuthState("unauthenticated")); }}
                  >
                    Sign out
                  </button>
                </div>
              )}
          </div>
        </header>
      )}

      {/* Impersonation banner */}
      {currentUser && typeof (currentUser as unknown as { impersonating?: boolean }).impersonating === "boolean" && (currentUser as unknown as { impersonating?: boolean }).impersonating ? (
        <div style={{ position: "fixed", top: 60, left: 0, right: 0, zIndex: 100, background: "#F59E0B", color: "#78350F", padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, fontWeight: 600, fontFamily: "var(--sans)" }}>
          <span>👁 Viewing as {currentUser.email} ({currentUser.role})</span>
          <button onClick={() => { void stopImpersonating().finally(() => { void getMyProfile().then((r) => setCurrentUser(r.user)); window.location.reload(); }); }} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #78350F", background: "transparent", color: "#78350F", fontWeight: 700, cursor: "pointer", fontFamily: "var(--sans)" }}>
            Exit — return to my account
          </button>
        </div>
      ) : null}

      {/* User settings drawer */}
      {showUserSettings && currentUser ? (
        <UserSettingsModal
          user={currentUser}
          onClose={() => setShowUserSettings(false)}
          onThemeChange={(theme) => {
            setCurrentUser((u) => u ? { ...u, theme } : u);
            const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
            const useDark = theme === "dark" || (theme === "system" && prefersDark);
            document.documentElement.classList.toggle("dark", useDark);
          }}
          onUserChange={(updates) => setCurrentUser((u) => u ? { ...u, ...updates } : u)}
        />
      ) : null}

      <div className={`main-layout ${hosted.embed || studioRoute || readerRoute || viewerRoute || homeRoute || helpRoute ? "embed-layout" : ""} ${readerRoute ? "reader-layout" : ""}`}>

        <main className={`content ${readerRoute ? "reader-content" : ""}`}>
          {catalogLoading && !objects.length && !tables.length && !studioDocument ? (
            <div style={{ padding: "20px 0", display: "grid", gap: 14 }}>
              <div className="skeleton-grid">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="skeleton-row">
                    <span className="skeleton skeleton-title" />
                    <span className="skeleton skeleton-text-sm" />
                    <span className="skeleton skeleton-text-sm" style={{ width: "40%" }} />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {requiresHostedStudioDocument && !catalogLoading && !studioDocument ? (
            <section className="sync-status sync-status-warn">
              <strong>Saved platform content has not loaded yet</strong>
              <span>The hosted app is waiting for the real saved platform document and is not falling back to seeded reports or dashboards.</span>
            </section>
          ) : null}
          {!authRequired && (
            <section className="sync-status" style={{ borderColor: "rgba(13,124,102,0.22)", background: "rgba(13,124,102,0.06)" }}>
              <strong>Open access mode</strong>
              <span>Sign-in is currently disabled. Contact your administrator to enable login and restrict access.</span>
            </section>
          )}
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
          {requiresHostedStudioDocument && !studioDocument ? (
            <section className="empty-page">
              <h1>Saved platform content is not available yet</h1>
              <p>The hosted studio document did not load, so the platform is holding on the last safe state instead of falling back to a blank or seeded workspace.</p>
              <button type="button" onClick={() => void reloadCatalog()}>Retry loading platform</button>
            </section>
          ) : (
            <Routes>
              <Route path="/" element={<HomePage objects={visibleObjects} studioDocument={displayDocument} recentIds={recentIds} openLinksInNewTab={openLinksInNewTab} onRefreshComplete={reloadCatalog} onToggleFavorite={toggleFavorite} />} />
              <Route path="/viewer" element={<ViewerPage objects={visibleObjects} studioDocument={displayDocument} recentIds={recentIds} openLinksInNewTab={openLinksInNewTab} onRefreshComplete={reloadCatalog} onToggleFavorite={toggleFavorite} />} />
              <Route path="/help" element={<HelpPage />} />
              <Route path="/studio" element={hasPerm("building.view") ? <StudioPage openSettingsSignal={studioSettingsSignal} userPermissions={userPermissions} launchContext={hosted} /> : <Navigate to={buildHostedRoute("/")} replace />} />
              <Route path="/studio/:objectId" element={hasPerm("building.view") ? <StudioPage openSettingsSignal={studioSettingsSignal} userPermissions={userPermissions} launchContext={hosted} /> : <Navigate to={buildHostedRoute("/")} replace />} />
              <Route path="/settings" element={hasPerm("settings.view") ? <StudioPage settingsMode userPermissions={userPermissions} launchContext={hosted} /> : <Navigate to={buildHostedRoute("/")} replace />} />
              <Route path="/users" element={hasPerm("users.view") ? <UserManagementPage currentUser={currentUser ?? undefined} /> : <Navigate to={buildHostedRoute("/")} replace />} />
              <Route path="/roles" element={hasPerm("roles.view") ? <RoleManagementPage /> : <Navigate to={buildHostedRoute("/")} replace />} />
              <Route path="/data" element={hasPerm("data.view") ? <DataManagementPage canImport={hasPerm("data.import")} canDelete={hasPerm("data.delete")} /> : <Navigate to={buildHostedRoute("/")} replace />} />
              <Route path="/reports" element={isAdminOrDev ? <ScheduledReportsPage studioDocument={displayDocument} /> : <Navigate to={buildHostedRoute("/")} replace />} />
              <Route path="/:type/:objectId" element={<ObjectPage tables={scopedTables} platformName={platformName} studioDocument={displayDocument} launchContext={hosted} openLinksInNewTab={openLinksInNewTab} onObjectViewed={markObjectAsRecent} onRefreshComplete={reloadCatalog} onUserSettingsChange={updateUserSettings} onToggleFavorite={toggleFavorite} />} />
              <Route path="*" element={<Navigate to={buildHostedRoute("/")} replace />} />
            </Routes>
          )}
        </main>
      </div>
      </div>{/* end app-content-with-sidebar */}
    </div>
  );
}
