import {
  type FilterDefinition,
  DashboardDefinition,
  type QuickbaseAppProfile,
  type QuickbaseBootstrapStatus,
  type QuickbaseConnectionConfig,
  type ReportPersonalOverride,
  ReportDefinition,
  ReportViewDefinition,
  SeedBundle,
  type StudioObjectScope,
  StudioDocument,
  TableDefinition,
  WidgetDefinition
} from "./models.js";
import { createFilterGroup } from "./report-engine.js";
import { touchStudioSession } from "./studio-session.js";

function timestamp(offset = 0): string {
  return new Date(Date.UTC(2026, 0, 15 + offset, 12, 0, 0)).toISOString();
}

function buildReportView(overrides: Partial<ReportViewDefinition> = {}): ReportViewDefinition {
  const mode = overrides.mode || "table";
  return {
    mode,
    showChartInTable: false,
    showSummary: overrides.showSummary ?? (mode === "table" || mode === "summary" || mode === "chart"),
    showDetails: overrides.showDetails ?? (mode === "table" || mode === "timeline" || mode === "calendar" || mode === "kanban"),
    chartTitle: "",
    decimalPlaces: 2,
    chartType: "bar",
    chartOrientation: "vertical",
    chartFieldId: "",
    chartSeriesFieldId: "",
    chartValueFieldId: "",
    chartAggregation: "count",
    chartSecondaryValueFieldId: "",
    chartSecondaryAggregation: "sum",
    chartUseSecondaryAxis: false,
    chartSecondarySeriesType: "line",
    chartTopN: 12,
    chartSort: "value-desc",
    chartColors: ["#0d7c66", "#d88d3d", "#5b7cfa", "#9b59b6", "#e66f5c", "#3a9782", "#b7a26a", "#4f8fba"],
    chartShowLegend: true,
    chartShowValues: true,
    chartXAxisLabel: "",
    chartYAxisLabel: "",
    chartSecondaryYAxisLabel: "",
    timelineDateField: "",
    timelineEndField: "",
    calendarDateField: "",
    kanbanField: "",
    titleFieldId: "",
    ...overrides
  };
}

function buildRefreshSchedule() {
  return {
    enabled: false,
    cadence: "daily" as const,
    timeOfDay: "02:00",
    dayOfWeek: 1,
    dayOfMonth: 1,
    timeZone: "America/Denver"
  };
}

function buildRefreshStatus() {
  return {
    running: false,
    activeJobId: "",
    cancelRequested: false,
    progress: 0,
    message: "",
    estimatedSecondsRemaining: undefined,
    lastStartedAt: "",
    lastCompletedAt: "",
    lastCancelledAt: "",
    lastSuccessAt: "",
    lastError: "",
    nextRunAt: "",
    cachedTableIds: [],
    cachedRowCount: 0
  };
}

function buildBootstrapStatus(overrides: Partial<QuickbaseBootstrapStatus> = {}): QuickbaseBootstrapStatus {
  return {
    ready: false,
    checkedAt: new Date().toISOString(),
    autoProvisioned: false,
    missing: [],
    warnings: [],
    message: "Quickbase support tables have not been validated yet.",
    ...overrides
  };
}

function buildDefaultQuickbaseConfig(): QuickbaseConnectionConfig {
  return {
    realmHostname: "cadencec.quickbase.com",
    userToken: "cazjr3_rnua_0_c5r36vs4exw6v2fi93pdn9gfng",
    appToken: "",
    appId: "bva8ar4ad",
    apiBaseUrl: "https://api.quickbase.com/v1",
    objectTableId: "bvysukdeq",
    objectKeyFieldId: "12",
    objectTypeFieldId: "6",
    objectNameFieldId: "7",
    objectConfigFieldId: "8",
    objectOwnerFieldId: "",
    objectUpdatedAtFieldId: "",
    objectUpdatedByFieldId: "",
    settingsTableId: "bvysupuj7",
    settingsUserFieldId: "6",
    settingsObjectFieldId: "7",
    settingsObjectKeyFieldId: "10",
    settingsJsonFieldId: "",
    settingsUpdatedByFieldId: "",
    versionTableId: "bvysvpq8m",
    versionObjectFieldId: "6",
    versionObjectKeyFieldId: "10",
    versionSnapshotFieldId: "7",
    versionChangedAtFieldId: "8",
    versionChangedByFieldId: "",
    versionUpdatedByFieldId: ""
  };
}

function buildQuickbaseProfile(overrides: Partial<QuickbaseAppProfile> = {}): QuickbaseAppProfile {
  return {
    id: "app-bva8ar4ad",
    label: "Cadence app",
    liveMode: false,
    quickbase: buildDefaultQuickbaseConfig(),
    bootstrap: buildBootstrapStatus({
      ready: true,
      message: "Quickbase support tables are configured."
    }),
    refreshSource: {
      tableIds: [],
      reportIds: {}
    },
    refreshSchedule: buildRefreshSchedule(),
    refreshStatus: buildRefreshStatus(),
    ...overrides
  };
}

function createReport(input: Partial<ReportDefinition> & Pick<ReportDefinition, "id" | "name" | "sourceTableId" | "selectedFieldIds">): ReportDefinition {
  const filters = input.filters || [];
  return {
    id: input.id,
    type: "report",
    schemaVersion: input.schemaVersion || 1,
    name: input.name,
    description: input.description || "",
    folder: input.folder || "Operations",
    category: input.category || "Reporting",
    tags: input.tags || [],
    scope: input.scope || "global",
    ownerUserId: input.ownerUserId || "",
    updatedAt: input.updatedAt || timestamp(),
    sourceTableId: input.sourceTableId,
    sourceReportOverrides: input.sourceReportOverrides || {},
    selectedFieldIds: input.selectedFieldIds,
    filters,
    filterTree: input.filterTree || createFilterGroup("and", filters),
    groups: input.groups || [],
    sorts: input.sorts || [],
    summaryMetrics: input.summaryMetrics || [],
    view: input.view || buildReportView(),
    displayLabels: input.displayLabels || { fields: {}, chartValues: {} }
  };
}

function createWidget(input: Partial<WidgetDefinition> & Pick<WidgetDefinition, "id" | "title" | "mode" | "reportId">): WidgetDefinition {
  return {
    id: input.id,
    title: input.title,
    mode: input.mode,
    displayMode: input.displayMode || "inherit",
    showDetails: input.showDetails ?? false,
    showSummary: input.showSummary ?? true,
    reportId: input.reportId,
    layout: {
      w: input.layout?.w || 6,
      h: input.layout?.h || 3,
      ...(Number.isFinite(Number(input.layout?.x)) ? { x: Math.max(1, Math.round(Number(input.layout?.x))) } : {}),
      ...(Number.isFinite(Number(input.layout?.y)) ? { y: Math.max(1, Math.round(Number(input.layout?.y))) } : {})
    },
    snapshot: input.snapshot
  };
}

function createDashboard(input: Partial<DashboardDefinition> & Pick<DashboardDefinition, "id" | "name" | "tabs">): DashboardDefinition {
  return {
    id: input.id,
    type: "dashboard",
    schemaVersion: input.schemaVersion || 1,
    name: input.name,
    description: input.description || "",
    folder: input.folder || "Executive",
    category: input.category || "Dashboard",
    tags: input.tags || [],
    scope: input.scope || "global",
    ownerUserId: input.ownerUserId || "",
    updatedAt: input.updatedAt || timestamp(),
    tabs: input.tabs,
    runtimeFilters: input.runtimeFilters || [],
    sourceReportOverrides: input.sourceReportOverrides || {}
  };
}

export function buildSeedBundle(): SeedBundle {
  const tables: TableDefinition[] = [
    {
      id: "projects",
      name: "Projects",
      description: "Portfolio and delivery projects.",
      fields: [
        { id: "recordId", label: "Record ID", type: "text" },
        { id: "projectName", label: "Project Name", type: "text" },
        { id: "status", label: "Status", type: "text", options: ["Active", "Planning", "Delayed", "Complete"] },
        { id: "owner", label: "Owner", type: "user" },
        { id: "region", label: "Region", type: "text", options: ["North", "South", "East", "West"] },
        { id: "budget", label: "Budget", type: "currency" },
        { id: "startDate", label: "Start Date", type: "date" },
        { id: "completion", label: "Completion", type: "number" }
      ]
    },
    {
      id: "tasks",
      name: "Tasks",
      description: "Execution pipeline items.",
      fields: [
        { id: "recordId", label: "Record ID", type: "text" },
        { id: "taskName", label: "Task Name", type: "text" },
        { id: "projectName", label: "Project Name", type: "text" },
        { id: "status", label: "Status", type: "text", options: ["Open", "In Progress", "Blocked", "Done"] },
        { id: "assignee", label: "Assignee", type: "user" },
        { id: "priority", label: "Priority", type: "text", options: ["Low", "Medium", "High"] },
        { id: "dueDate", label: "Due Date", type: "date" },
        { id: "hours", label: "Hours", type: "number" }
      ]
    },
    {
      id: "invoices",
      name: "Invoices",
      description: "Billing and collection status.",
      fields: [
        { id: "recordId", label: "Record ID", type: "text" },
        { id: "customer", label: "Customer", type: "text" },
        { id: "region", label: "Region", type: "text", options: ["North", "South", "East", "West"] },
        { id: "amount", label: "Amount", type: "currency" },
        { id: "invoiceDate", label: "Invoice Date", type: "date" },
        { id: "paidDate", label: "Paid Date", type: "date" },
        { id: "status", label: "Status", type: "text", options: ["Open", "Paid", "Overdue"] }
      ]
    }
  ];

  const data = {
    projects: [
      { recordId: "P-1001", projectName: "Atlas Migration", status: "Active", owner: "A. Brooks", region: "North", budget: 185000, startDate: "2026-01-02", completion: 64 },
      { recordId: "P-1002", projectName: "Mercury Expansion", status: "Planning", owner: "S. Patel", region: "West", budget: 92000, startDate: "2026-02-14", completion: 22 },
      { recordId: "P-1003", projectName: "Beacon Revamp", status: "Delayed", owner: "J. Kim", region: "South", budget: 143500, startDate: "2025-12-08", completion: 49 },
      { recordId: "P-1004", projectName: "Harbor Rollout", status: "Active", owner: "L. Evans", region: "East", budget: 211000, startDate: "2026-01-18", completion: 71 },
      { recordId: "P-1005", projectName: "Nova Launch", status: "Complete", owner: "M. Diaz", region: "North", budget: 126000, startDate: "2025-10-02", completion: 100 }
    ],
    tasks: [
      { recordId: "T-2001", taskName: "Finalize scope", projectName: "Atlas Migration", status: "Done", assignee: "A. Brooks", priority: "High", dueDate: "2026-01-09", hours: 14 },
      { recordId: "T-2002", taskName: "Provision sandbox", projectName: "Mercury Expansion", status: "In Progress", assignee: "R. Singh", priority: "Medium", dueDate: "2026-02-21", hours: 11 },
      { recordId: "T-2003", taskName: "Resolve vendor issue", projectName: "Beacon Revamp", status: "Blocked", assignee: "J. Kim", priority: "High", dueDate: "2026-01-25", hours: 18 },
      { recordId: "T-2004", taskName: "Train field teams", projectName: "Harbor Rollout", status: "Open", assignee: "L. Evans", priority: "Medium", dueDate: "2026-02-03", hours: 8 },
      { recordId: "T-2005", taskName: "QA signoff", projectName: "Nova Launch", status: "Done", assignee: "M. Diaz", priority: "Low", dueDate: "2026-01-04", hours: 5 }
    ],
    invoices: [
      { recordId: "I-3001", customer: "Northstar Health", region: "North", amount: 42000, invoiceDate: "2026-01-03", paidDate: "", status: "Open" },
      { recordId: "I-3002", customer: "Summit Retail", region: "West", amount: 18500, invoiceDate: "2025-12-18", paidDate: "2026-01-02", status: "Paid" },
      { recordId: "I-3003", customer: "Blue Ridge Energy", region: "South", amount: 27600, invoiceDate: "2025-12-27", paidDate: "", status: "Overdue" },
      { recordId: "I-3004", customer: "Harbor Foods", region: "East", amount: 39100, invoiceDate: "2026-01-06", paidDate: "", status: "Open" },
      { recordId: "I-3005", customer: "Nova Telecom", region: "North", amount: 24500, invoiceDate: "2025-12-30", paidDate: "2026-01-08", status: "Paid" }
    ]
  };

  const projects = createReport({
    id: "report-project-portfolio",
    name: "Project Portfolio",
    sourceTableId: "projects",
    selectedFieldIds: ["recordId", "projectName", "status", "owner", "region", "budget", "startDate", "completion"],
    description: "Portfolio health and delivery progress across active and planned work.",
    updatedAt: timestamp(1),
    tags: ["portfolio", "delivery"],
    filters: [{ id: "filter-project-status", fieldId: "status", operator: "equals", value: "Active" }],
    summaryMetrics: [
      { id: "metric-project-count", fieldId: "recordId", op: "count", label: "Projects" },
      { id: "metric-project-budget", fieldId: "budget", op: "sum", label: "Budget" },
      { id: "metric-project-completion", fieldId: "completion", op: "avg", label: "Avg progress" }
    ],
    view: buildReportView({
      mode: "chart",
      chartType: "bar",
      chartFieldId: "region",
      titleFieldId: "projectName"
    })
  });

  const tasks = createReport({
    id: "report-task-pipeline",
    name: "Task Pipeline",
    sourceTableId: "tasks",
    selectedFieldIds: ["recordId", "taskName", "projectName", "status", "assignee", "priority", "dueDate", "hours"],
    description: "Execution pipeline by status and assignee.",
    updatedAt: timestamp(2),
    tags: ["tasks", "operations"],
    groups: [{ id: "group-task-status", fieldId: "status" }],
    summaryMetrics: [
      { id: "metric-task-count", fieldId: "recordId", op: "count", label: "Tasks" },
      { id: "metric-task-hours", fieldId: "hours", op: "sum", label: "Hours" }
    ],
    view: buildReportView({
      mode: "kanban",
      kanbanField: "status",
      titleFieldId: "taskName"
    })
  });

  const invoices = createReport({
    id: "report-invoice-health",
    name: "Invoice Health",
    sourceTableId: "invoices",
    selectedFieldIds: ["recordId", "customer", "region", "amount", "invoiceDate", "paidDate", "status"],
    description: "Open receivables, collection risk, and invoice aging.",
    updatedAt: timestamp(3),
    tags: ["finance", "receivables"],
    filters: [{ id: "filter-invoice-status", fieldId: "status", operator: "equals", value: "Open" }],
    summaryMetrics: [
      { id: "metric-invoice-count", fieldId: "recordId", op: "count", label: "Invoices" },
      { id: "metric-invoice-amount", fieldId: "amount", op: "sum", label: "Open value" }
    ],
    view: buildReportView({
      mode: "summary",
      titleFieldId: "customer"
    })
  });

  const personalProjects = createReport({
    id: "report-my-active-projects",
    name: "My Active Projects",
    sourceTableId: "projects",
    selectedFieldIds: ["recordId", "projectName", "status", "owner", "region", "completion"],
    description: "Personal working view for current owned projects.",
    updatedAt: timestamp(5),
    tags: ["personal", "portfolio"],
    scope: "personal",
    ownerUserId: "demo.user",
    filters: [{ id: "filter-my-project-owner", fieldId: "owner", operator: "equals", value: "A. Brooks" }],
    view: buildReportView({
      mode: "table",
      titleFieldId: "projectName"
    })
  });

  const dashboard = createDashboard({
    id: "dashboard-executive-pulse",
    name: "Executive Pulse",
    description: "Operations, delivery, and finance in one hosted dashboard.",
    updatedAt: timestamp(4),
    tags: ["executive", "weekly"],
    tabs: [
      {
        id: "tab-overview",
        name: "Overview",
        widgets: [
          createWidget({ id: "widget-overview-projects", title: "Project Portfolio", mode: "linked", reportId: projects.id, layout: { w: 7, h: 4 } }),
          createWidget({ id: "widget-overview-tasks", title: "Task Pipeline", mode: "linked", reportId: tasks.id, layout: { w: 5, h: 4 } })
        ]
      },
      {
        id: "tab-finance",
        name: "Finance",
        widgets: [
          createWidget({ id: "widget-finance-invoices", title: "Invoice Health", mode: "linked", reportId: invoices.id, layout: { w: 6, h: 4 } }),
          createWidget({ id: "widget-finance-projects", title: "Regional Portfolio Mix", mode: "copied", reportId: projects.id, snapshot: { ...projects, id: "snapshot-project-portfolio", view: buildReportView({ mode: "chart", chartType: "donut", chartFieldId: "region", titleFieldId: "projectName" }) }, layout: { w: 6, h: 4 } })
        ]
      }
    ],
    runtimeFilters: [
      { id: "runtime-status", label: "Status", fieldId: "status", mode: "global", targetReportIds: [], defaultValue: "" },
      { id: "runtime-start-date", label: "Date range", fieldId: "startDate", mode: "selected", targetReportIds: [projects.id], defaultValue: "CURRENT_MONTH" }
    ]
  });

  const objects = {
    [dashboard.id]: dashboard,
    [projects.id]: projects,
    [tasks.id]: tasks,
    [invoices.id]: invoices,
    [personalProjects.id]: personalProjects
  };

  return {
    app: {
      id: "seed-app",
      name: "Hosted Reporting Platform"
    },
    tables,
    data,
    objects,
    order: [dashboard.id, projects.id, tasks.id, invoices.id, personalProjects.id]
  };
}

export function buildStudioDocument(): StudioDocument {
  const bundle = buildSeedBundle();
  const dashboard = bundle.objects["dashboard-executive-pulse"];
  const groupedTaskReport = bundle.objects["report-task-pipeline"];
  const defaultQuickbase = buildDefaultQuickbaseConfig();
  const defaultProfile = buildQuickbaseProfile({ quickbase: defaultQuickbase });

  return {
    schemaVersion: 1,
    bundle,
    favorites: ["dashboard-executive-pulse"],
    recent: ["dashboard-executive-pulse"],
    personalOverrides: {
      dashboards: {
        "dashboard-executive-pulse": {
          runtimeFilters: {
            "runtime-status": "",
            "runtime-start-date": "CURRENT_MONTH"
          },
          activeTabId: "tab-overview",
          focusedWidgetId: "",
          savedViews: [
            {
              id: "dashboard-view-open-overview",
              name: "Open Overview",
              runtimeFilters: {
                "runtime-status": "Open",
                "runtime-start-date": "CURRENT_MONTH"
              },
              activeTabId: "tab-overview",
              focusedWidgetId: "",
              updatedAt: timestamp(6)
            }
          ],
          updatedAt: timestamp(6)
        }
      },
      reports: {
        "report-project-portfolio": {
          currentPage: 1,
          focusMode: "default",
          focusedSection: "",
          savedViews: [
            {
              id: "report-view-chart",
              name: "Chart Focus",
              currentPage: 1,
              focusMode: "chart",
              focusedSection: "chart",
              updatedAt: timestamp(6)
            }
          ],
          updatedAt: timestamp(6)
        }
      }
    },
    session: {
      ...touchStudioSession({
        currentUserId: "demo.user",
        launchSource: "local-dev",
        inactivityTimeoutHours: 24,
        requiresLaunch: true,
        launchedAt: "",
        lastActivityAt: "",
        expiresAt: "",
        lastValidatedAt: ""
      }, {
        relaunch: true,
        launchSource: "local-dev",
        currentUserId: "demo.user",
        inactivityTimeoutHours: 24,
        requiresLaunch: true
      })
    },
    branding: {
      platformName: "Cadence Reporting Portal",
      navigationLabel: "Reports and Dashboards",
      homeLabel: "Workspace",
      openLinksInNewTab: false
    },
    quickbase: defaultQuickbase,
    quickbaseProfiles: [defaultProfile],
    activeQuickbaseProfileId: defaultProfile.id,
    templates: {
      layouts: dashboard ? [{
        id: "template-layout-executive",
        type: "layout",
        name: "Executive starter",
        object: JSON.parse(JSON.stringify(dashboard))
      }] : [],
      yaml: groupedTaskReport ? [{
        id: "template-yaml-task-pipeline",
        type: "yaml",
        name: "Grouped task report",
        object: JSON.parse(JSON.stringify(groupedTaskReport))
      }] : [],
      upload: [{
        id: "template-upload-invoice-mapping",
        type: "upload",
        name: "Invoice import mapping",
        tableId: "invoices",
        columnMap: {
          Customer: "customer",
          Region: "region",
          Amount: "amount",
          Status: "status"
        },
        object: null
      }]
    },
    versions: {},
    exportJobs: [],
    sync: {
      providerMode: "api",
      lastSavedAt: "",
      lastLoadedAt: "",
      refreshSchedule: buildRefreshSchedule(),
      refreshStatus: {
        ...buildRefreshStatus(),
        lastError: "",
        nextRunAt: "",
        cachedTableIds: [],
        cachedRowCount: 0
      }
    }
  };
}

function mergeQuickbaseDefaults(defaults: StudioDocument["quickbase"], source?: Partial<StudioDocument["quickbase"]>) {
  const current = source || {};
  const legacyPlaceholders = new Set([
    "example.quickbase.com",
    "QB-EXAMPLE",
    "bp1234567"
  ]);

  const resolve = (key: keyof StudioDocument["quickbase"]) => {
    const value = current[key];
    const text = typeof value === "string" ? value.trim() : "";
    if (!text || legacyPlaceholders.has(text)) {
      return defaults[key];
    }
    return value as string;
  };

  return {
    ...defaults,
    ...current,
    realmHostname: resolve("realmHostname"),
    userToken: resolve("userToken"),
    appId: resolve("appId"),
    apiBaseUrl: resolve("apiBaseUrl"),
    objectTableId: resolve("objectTableId"),
    objectKeyFieldId: resolve("objectKeyFieldId"),
    objectTypeFieldId: resolve("objectTypeFieldId"),
    objectNameFieldId: resolve("objectNameFieldId"),
    objectConfigFieldId: resolve("objectConfigFieldId"),
    objectOwnerFieldId: resolve("objectOwnerFieldId"),
    objectUpdatedAtFieldId: resolve("objectUpdatedAtFieldId"),
    objectUpdatedByFieldId: resolve("objectUpdatedByFieldId"),
    settingsTableId: resolve("settingsTableId"),
    settingsUserFieldId: resolve("settingsUserFieldId"),
    settingsObjectFieldId: resolve("settingsObjectFieldId"),
    settingsObjectKeyFieldId: resolve("settingsObjectKeyFieldId"),
    settingsJsonFieldId: resolve("settingsJsonFieldId"),
    settingsUpdatedByFieldId: resolve("settingsUpdatedByFieldId"),
    versionTableId: resolve("versionTableId"),
    versionObjectFieldId: resolve("versionObjectFieldId"),
    versionObjectKeyFieldId: resolve("versionObjectKeyFieldId"),
    versionSnapshotFieldId: resolve("versionSnapshotFieldId"),
    versionChangedAtFieldId: resolve("versionChangedAtFieldId"),
    versionChangedByFieldId: resolve("versionChangedByFieldId"),
    versionUpdatedByFieldId: resolve("versionUpdatedByFieldId")
  };
}

function mergeQuickbaseProfile(defaults: QuickbaseAppProfile, source?: Partial<QuickbaseAppProfile>): QuickbaseAppProfile {
  const current = source || {};
  return {
    ...defaults,
    ...current,
    label: String(current.label || defaults.label),
    liveMode: current.liveMode === true,
    quickbase: mergeQuickbaseDefaults(defaults.quickbase, current.quickbase),
    bootstrap: {
      ...defaults.bootstrap,
      ...(current.bootstrap || {}),
      ready: current.bootstrap?.ready === true,
      checkedAt: String(current.bootstrap?.checkedAt || defaults.bootstrap.checkedAt || new Date().toISOString()),
      autoProvisioned: current.bootstrap?.autoProvisioned === true,
      missing: Array.isArray(current.bootstrap?.missing) ? current.bootstrap.missing.map(String) : defaults.bootstrap.missing,
      warnings: Array.isArray(current.bootstrap?.warnings) ? current.bootstrap.warnings.map(String) : defaults.bootstrap.warnings,
      message: String(current.bootstrap?.message || defaults.bootstrap.message),
      error: current.bootstrap?.error ? String(current.bootstrap.error) : undefined
    },
    refreshSource: {
      tableIds: Array.isArray(current.refreshSource?.tableIds) ? current.refreshSource.tableIds.map(String) : defaults.refreshSource.tableIds,
      reportIds: Object.fromEntries(
        Object.entries(current.refreshSource?.reportIds || defaults.refreshSource.reportIds).map(([key, value]) => [String(key), String(value || "")])
      )
    },
    refreshSchedule: {
      ...defaults.refreshSchedule,
      ...(current.refreshSchedule || {})
    },
    refreshStatus: {
      ...defaults.refreshStatus,
      ...(current.refreshStatus || {})
    }
  };
}

export function normalizeStudioDocument(input: Partial<StudioDocument> | null | undefined): StudioDocument {
  const defaults = buildStudioDocument();
  const source = input || {};
  const normalizedProfiles = (source.quickbaseProfiles?.length ? source.quickbaseProfiles : defaults.quickbaseProfiles)
    .map((profile, index) => mergeQuickbaseProfile(defaults.quickbaseProfiles[0], {
      ...profile,
      id: String(profile.id || `app-profile-${index + 1}`)
    }));
  const activeQuickbaseProfileId = normalizedProfiles.some((profile) => profile.id === source.activeQuickbaseProfileId)
    ? String(source.activeQuickbaseProfileId)
    : normalizedProfiles[0]?.id || "";
  const activeProfile = normalizedProfiles.find((profile) => profile.id === activeQuickbaseProfileId);
  const normalizedObjects = Object.fromEntries(
    Object.entries(source.bundle?.objects || defaults.bundle.objects).map(([id, object]) => {
      if (object.type === "report") {
        const displayLabels = object.displayLabels || {};
        const filters = object.filters || [];
        return [id, {
          ...object,
          schemaVersion: Number(object.schemaVersion || 1),
          scope: ((object.scope || "global") as StudioObjectScope),
          ownerUserId: String(object.ownerUserId || ""),
          sourceReportOverrides: Object.fromEntries(
            Object.entries(object.sourceReportOverrides || {}).map(([key, value]) => [String(key), String(value || "")])
          ),
          filters,
          filterTree: object.filterTree || createFilterGroup("and", filters as FilterDefinition[]),
          view: buildReportView(object.view || {}),
          displayLabels: { fields: displayLabels.fields || {}, chartValues: displayLabels.chartValues || {} }
        }];
      }
      return [id, {
        ...object,
        schemaVersion: Number(object.schemaVersion || 1),
        scope: ((object.scope || "global") as StudioObjectScope),
        ownerUserId: String(object.ownerUserId || ""),
        sourceReportOverrides: Object.fromEntries(
          Object.entries(object.sourceReportOverrides || {}).map(([key, value]) => [String(key), String(value || "")])
        ),
        tabs: (object.tabs || []).map((tab, tabIndex) => ({
          ...tab,
          id: String(tab.id || `tab-${tabIndex + 1}`),
          name: String(tab.name || `Tab ${tabIndex + 1}`),
          widgets: (tab.widgets || []).map((widget, widgetIndex) => ({
            id: String(widget.id || `widget-${tabIndex + 1}-${widgetIndex + 1}`),
            title: String(widget.title || ""),
            mode: widget.mode === "copied" ? "copied" : "linked",
            displayMode: widget.displayMode === "table" || widget.displayMode === "summary" || widget.displayMode === "chart" ? widget.displayMode : "inherit",
            showDetails: widget.showDetails === true,
            showSummary: widget.showSummary !== false,
            reportId: String(widget.reportId || ""),
            layout: {
              w: Math.max(1, Number(widget.layout?.w) || 6),
              h: Math.max(2, Number(widget.layout?.h) || 3),
              ...(Number.isFinite(Number(widget.layout?.x)) ? { x: Math.max(1, Math.round(Number(widget.layout?.x))) } : {}),
              ...(Number.isFinite(Number(widget.layout?.y)) ? { y: Math.max(1, Math.round(Number(widget.layout?.y))) } : {})
            },
            snapshot: widget.snapshot
          }))
        }))
      }];
    })
  );
  return {
    ...defaults,
    ...source,
    schemaVersion: Number(source.schemaVersion || defaults.schemaVersion || 1),
    bundle: {
      ...defaults.bundle,
      ...(source.bundle || {}),
      app: {
        ...defaults.bundle.app,
        ...(source.bundle?.app || {})
      },
      tables: (source.bundle?.tables || defaults.bundle.tables).map((table) => ({
        ...table,
        quickbaseProfileId: table.quickbaseProfileId || "",
        quickbaseTableId: table.quickbaseTableId || "",
        quickbaseAppId: table.quickbaseAppId || ""
      })),
      data: source.bundle?.data || defaults.bundle.data,
      objects: normalizedObjects,
      order: source.bundle?.order || defaults.bundle.order
    },
    personalOverrides: {
      dashboards: Object.fromEntries(
        Object.entries(source.personalOverrides?.dashboards || defaults.personalOverrides.dashboards).map(([objectId, override]) => [
          String(objectId),
          {
            runtimeFilters: Object.fromEntries(Object.entries(override?.runtimeFilters || {}).map(([key, value]) => [String(key), String(value || "")])),
            activeTabId: String(override?.activeTabId || ""),
            focusedWidgetId: String(override?.focusedWidgetId || ""),
            savedViews: Array.isArray(override?.savedViews)
              ? override.savedViews.map((view) => ({
                  id: String(view?.id || ""),
                  name: String(view?.name || "Saved view"),
                  runtimeFilters: Object.fromEntries(Object.entries(view?.runtimeFilters || {}).map(([key, value]) => [String(key), String(value || "")])),
                  activeTabId: String(view?.activeTabId || ""),
                  focusedWidgetId: String(view?.focusedWidgetId || ""),
                  updatedAt: String(view?.updatedAt || new Date().toISOString())
                })).filter((view) => view.id && view.name)
              : [],
            updatedAt: String(override?.updatedAt || new Date().toISOString())
          }
        ])
      ),
      reports: Object.fromEntries(
        Object.entries(source.personalOverrides?.reports || defaults.personalOverrides.reports).map(([objectId, override]) => [
          String(objectId),
          {
            currentPage: Math.max(1, Number(override?.currentPage) || 1),
            focusMode: override?.focusMode === "summary" || override?.focusMode === "chart" || override?.focusMode === "details" ? override.focusMode : "default",
            focusedSection: override?.focusedSection === "chart" || override?.focusedSection === "details" ? override.focusedSection : "",
            savedViews: Array.isArray(override?.savedViews)
              ? override.savedViews.map((view) => {
                  const focusMode = view?.focusMode === "summary" || view?.focusMode === "chart" || view?.focusMode === "details" ? view.focusMode : "default";
                  const focusedSection = view?.focusedSection === "chart" || view?.focusedSection === "details" ? view.focusedSection : "";
                  return {
                    id: String(view?.id || ""),
                    name: String(view?.name || "Saved view"),
                    currentPage: Math.max(1, Number(view?.currentPage) || 1),
                    focusMode,
                    focusedSection,
                    updatedAt: String(view?.updatedAt || new Date().toISOString())
                  };
                }).filter((view) => view.id && view.name) as ReportPersonalOverride["savedViews"]
              : ([] as ReportPersonalOverride["savedViews"]),
            updatedAt: String(override?.updatedAt || new Date().toISOString())
          }
        ])
      )
    },
    session: {
      ...touchStudioSession({
        ...defaults.session,
        ...(source.session || {}),
        currentUserId: String(source.session?.currentUserId || defaults.session.currentUserId || ""),
        launchSource: source.session?.launchSource === "quickbase-button" ? "quickbase-button" : defaults.session.launchSource,
        inactivityTimeoutHours: Number(source.session?.inactivityTimeoutHours || defaults.session.inactivityTimeoutHours || 24),
        requiresLaunch: source.session?.requiresLaunch ?? defaults.session.requiresLaunch,
        launchedAt: String(source.session?.launchedAt || defaults.session.launchedAt || ""),
        lastActivityAt: String(source.session?.lastActivityAt || defaults.session.lastActivityAt || ""),
        expiresAt: String(source.session?.expiresAt || defaults.session.expiresAt || ""),
        lastValidatedAt: String(source.session?.lastValidatedAt || defaults.session.lastValidatedAt || "")
      })
    },
    branding: {
      ...defaults.branding,
      ...(source.branding || {})
    },
    quickbaseProfiles: normalizedProfiles,
    activeQuickbaseProfileId,
    quickbase: mergeQuickbaseDefaults(defaults.quickbase, activeProfile?.quickbase || source.quickbase),
    templates: {
      layouts: source.templates?.layouts || defaults.templates.layouts,
      yaml: source.templates?.yaml || defaults.templates.yaml,
      upload: source.templates?.upload || defaults.templates.upload
    },
    versions: source.versions || defaults.versions,
    exportJobs: (source.exportJobs || defaults.exportJobs).map((job) => ({
      id: String(job?.id || `job-${Math.random().toString(36).slice(2, 10)}`),
      objectId: String(job?.objectId || "studio"),
      objectType: job?.objectType === "report" || job?.objectType === "dashboard" ? job.objectType : "studio",
      format: job?.format === "xlsx" ? "xlsx" : "json",
      status: job?.status === "queued" || job?.status === "running" || job?.status === "failed" ? job.status : "complete",
      progress: Math.max(0, Math.min(100, Number(job?.progress ?? (job?.status === "complete" ? 100 : 0)) || 0)),
      message: String(job?.message || (job?.status === "failed" ? job?.error || "Export failed." : job?.format === "xlsx" ? "Workbook export" : "JSON export")),
      filename: job?.filename ? String(job.filename) : undefined,
      error: job?.error ? String(job.error) : undefined,
      updatedAt: String(job?.updatedAt || job?.createdAt || new Date().toISOString()),
      sourceJobId: job?.sourceJobId ? String(job.sourceJobId) : undefined,
      runtimeFilters: Object.fromEntries(Object.entries(job?.runtimeFilters || {}).map(([key, value]) => [String(key), String(value || "")])),
      createdAt: String(job?.createdAt || new Date().toISOString())
    })),
    favorites: source.favorites || defaults.favorites,
    recent: source.recent || defaults.recent,
    sync: {
      ...defaults.sync,
      ...(source.sync || {}),
      refreshSchedule: {
        ...defaults.sync.refreshSchedule,
        ...(source.sync?.refreshSchedule || {})
      },
      refreshStatus: {
        ...defaults.sync.refreshStatus,
        ...(source.sync?.refreshStatus || {})
      }
    }
  };
}
