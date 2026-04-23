import type { Page, Route } from "@playwright/test";
import {
  buildDashboardFilters,
  buildStudioDocument,
  buildDashboardResult,
  resolveActiveDashboardTabId,
  runReport,
  type DashboardDefinition,
  type DashboardRunResult,
  type FilterDefinition,
  type ReportDefinition,
  type ReportRunResult,
  type StudioDocument,
  type StudioObject,
  type TableDefinition
} from "@studio/shared";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function okJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

function parseBody(request: Route["request"]) {
  const text = request.postData() || "";
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const params = new URLSearchParams(text);
    const payload = params.get("payload");
    if (payload) {
      try {
        return JSON.parse(payload);
      } catch {
        return {};
      }
    }
    return {};
  }
}

function normalizeClientFilters(input: unknown): FilterDefinition[] {
  if (!Array.isArray(input)) return [];
  return input.map((item, index) => {
    const current = (item || {}) as Record<string, unknown>;
    return {
      id: `client-filter-${index + 1}`,
      fieldId: String(current.fieldId || ""),
      operator: String(current.operator || "equals") as FilterDefinition["operator"],
      value: String(current.value || "")
    };
  }).filter((filter) => filter.fieldId);
}

function getObject(document: StudioDocument, id: string) {
  return document.bundle.objects[id] || null;
}

function getTable(document: StudioDocument, tableId: string) {
  return document.bundle.tables.find((table) => table.id === tableId) || null;
}

function buildCatalogObjects(document: StudioDocument) {
  return document.bundle.order
    .map((id) => document.bundle.objects[id])
    .filter(Boolean)
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
      updatedAt: object.updatedAt
    }));
}

function paginateReportResult(result: ReportRunResult, page: number, pageSize: number): ReportRunResult {
  const safePage = Math.max(1, page || 1);
  const safePageSize = Math.max(1, pageSize || 100);
  const start = (safePage - 1) * safePageSize;
  const rows = result.rows.slice(start, start + safePageSize);
  const totalPages = Math.max(1, Math.ceil(result.totalRows / safePageSize));
  return {
    ...result,
    rows,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
    hasNextPage: safePage < totalPages
  };
}

function executeDashboard(document: StudioDocument, dashboard: DashboardDefinition, runtimeFilters: Record<string, string>, activeTabId = ""): DashboardRunResult {
  const tabsToRender = activeTabId
    ? dashboard.tabs.filter((tab) => tab.id === activeTabId)
    : dashboard.tabs;
  const widgets = tabsToRender.flatMap((tab) =>
    tab.widgets.map((widget) => {
      const report = (widget.mode === "copied" && widget.snapshot ? widget.snapshot : getObject(document, widget.reportId)) as ReportDefinition;
      const table = getTable(document, report.sourceTableId) as TableDefinition;
      const result = runReport(report, table, document.bundle.data[table.id] || [], buildDashboardFilters(dashboard, report.id, runtimeFilters, report.sourceTableId));
      return {
        widgetId: widget.id,
        widget,
        report,
        result,
        status: "complete" as const,
        message: result.totalRows ? `${result.totalRows} row${result.totalRows === 1 ? "" : "s"}` : "No rows returned"
      };
    })
  );
  return buildDashboardResult(dashboard, widgets);
}

export async function mockStudioApi(page: Page, options: { expiredSession?: boolean } = {}) {
  let document = clone(buildStudioDocument());
  if (options.expiredSession) {
    document.session.lastActivityAt = "2026-04-21T10:00:00.000Z";
    document.session.expiresAt = "2026-04-21T10:05:00.000Z";
    document.session.requiresLaunch = true;
    document.session.launchSource = "local-dev";
  }

  await page.route("http://localhost:3001/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === "GET" && path === "/api/catalog") {
      return okJson(route, {
        app: document.bundle.app,
        objects: buildCatalogObjects(document)
      });
    }

    if (method === "GET" && path === "/api/tables") {
      return okJson(route, { tables: document.bundle.tables });
    }

    if (method === "GET" && path === "/api/studio/document") {
      return okJson(route, { document });
    }

    if (method === "PATCH" && path === "/api/studio/user-settings") {
      const body = parseBody(request) as Partial<Pick<StudioDocument, "favorites" | "recent" | "personalOverrides">>;
      document = {
        ...document,
        ...(body.favorites ? { favorites: body.favorites.map(String) } : {}),
        ...(body.recent ? { recent: body.recent.map(String) } : {}),
        ...(body.personalOverrides ? { personalOverrides: body.personalOverrides } : {})
      };
      return okJson(route, { document });
    }

    if (method === "PATCH" && path === "/api/studio/session") {
      const body = parseBody(request) as { session?: Partial<StudioDocument["session"]> };
      document = {
        ...document,
        session: {
          ...document.session,
          ...(body.session || {})
        }
      };
      return okJson(route, { document });
    }

    if (method === "GET" && path.startsWith("/api/objects/")) {
      const id = decodeURIComponent(path.slice("/api/objects/".length));
      const object = getObject(document, id);
      return object
        ? okJson(route, { object })
        : okJson(route, { message: "Not found" }, 404);
    }

    if (method === "POST" && path.match(/^\/api\/reports\/[^/]+\/run$/)) {
      const id = decodeURIComponent(path.split("/")[3] || "");
      const report = getObject(document, id) as ReportDefinition | null;
      const body = parseBody(request) as { filters?: unknown };
      const table = report ? getTable(document, report.sourceTableId) : null;
      if (!report || !table) {
        return okJson(route, { message: "Report not found" }, 404);
      }
      const result = runReport(report, table, document.bundle.data[table.id] || [], normalizeClientFilters(body.filters));
      return okJson(route, paginateReportResult(result, 1, 100));
    }

    if (method === "POST" && path.match(/^\/api\/reports\/[^/]+\/page$/)) {
      const id = decodeURIComponent(path.split("/")[3] || "");
      const report = getObject(document, id) as ReportDefinition | null;
      const body = parseBody(request) as { filters?: unknown; page?: number; pageSize?: number };
      const table = report ? getTable(document, report.sourceTableId) : null;
      if (!report || !table) {
        return okJson(route, { message: "Report not found" }, 404);
      }
      const result = runReport(report, table, document.bundle.data[table.id] || [], normalizeClientFilters(body.filters));
      return okJson(route, paginateReportResult(result, Number(body.page) || 1, Number(body.pageSize) || 100));
    }

    if (method === "POST" && path.match(/^\/api\/dashboards\/[^/]+\/render$/)) {
      const id = decodeURIComponent(path.split("/")[3] || "");
      const dashboard = getObject(document, id) as DashboardDefinition | null;
      const body = parseBody(request) as { runtimeFilters?: Record<string, string>; activeTabId?: string };
      if (!dashboard) {
        return okJson(route, { message: "Dashboard not found" }, 404);
      }
      return okJson(route, executeDashboard(document, dashboard, body.runtimeFilters || {}, body.activeTabId || resolveActiveDashboardTabId(dashboard)));
    }

    if (method === "GET" && path === "/api/exports/jobs") {
      return okJson(route, { jobs: [] });
    }

    if (method === "GET" && path.startsWith("/api/studio/refresh/jobs/")) {
      return okJson(route, {
        job: {
          id: path.split("/").pop() || "refresh-job",
          status: "complete",
          progress: 100,
          message: "Refresh complete",
          reason: "manual",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      });
    }

    if (method === "POST" && (path === "/api/studio/refresh/start" || path.match(/^\/api\/studio\/objects\/[^/]+\/refresh\/start$/))) {
      return okJson(route, {
        job: {
          id: "refresh-job",
          status: "running",
          progress: 20,
          message: "Refreshing",
          reason: "manual",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      });
    }

    return okJson(route, { message: `Unhandled mock route: ${method} ${path}` }, 404);
  });
}
