import {
  type FilterDefinition,
  DashboardDefinition,
  ReportDefinition,
  ReportViewDefinition,
  SeedBundle,
  StudioDocument,
  TableDefinition,
  WidgetDefinition
} from "./models.js";
import { createFilterGroup } from "./report-engine.js";

function timestamp(offset = 0): string {
  return new Date(Date.UTC(2026, 0, 15 + offset, 12, 0, 0)).toISOString();
}

function buildReportView(overrides: Partial<ReportViewDefinition> = {}): ReportViewDefinition {
  return {
    mode: "table",
    showChartInTable: false,
    chartType: "bar",
    chartOrientation: "vertical",
    chartFieldId: "",
    chartValueFieldId: "",
    chartAggregation: "count",
    chartTopN: 12,
    chartSort: "value-desc",
    chartShowLegend: true,
    chartShowValues: true,
    chartXAxisLabel: "",
    chartYAxisLabel: "",
    timelineDateField: "",
    timelineEndField: "",
    calendarDateField: "",
    kanbanField: "",
    titleFieldId: "",
    ...overrides
  };
}

function createReport(input: Partial<ReportDefinition> & Pick<ReportDefinition, "id" | "name" | "sourceTableId" | "selectedFieldIds">): ReportDefinition {
  const filters = input.filters || [];
  return {
    id: input.id,
    type: "report",
    name: input.name,
    description: input.description || "",
    folder: input.folder || "Operations",
    category: input.category || "Reporting",
    tags: input.tags || [],
    updatedAt: input.updatedAt || timestamp(),
    sourceTableId: input.sourceTableId,
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
    layout: input.layout || { w: 6, h: 3 },
    snapshot: input.snapshot
  };
}

function createDashboard(input: Partial<DashboardDefinition> & Pick<DashboardDefinition, "id" | "name" | "tabs">): DashboardDefinition {
  return {
    id: input.id,
    type: "dashboard",
    name: input.name,
    description: input.description || "",
    folder: input.folder || "Executive",
    category: input.category || "Dashboard",
    tags: input.tags || [],
    updatedAt: input.updatedAt || timestamp(),
    tabs: input.tabs,
    runtimeFilters: input.runtimeFilters || []
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
    [invoices.id]: invoices
  };

  return {
    app: {
      id: "seed-app",
      name: "Hosted Reporting Platform"
    },
    tables,
    data,
    objects,
    order: [dashboard.id, projects.id, tasks.id, invoices.id]
  };
}

export function buildStudioDocument(): StudioDocument {
  const bundle = buildSeedBundle();
  const dashboard = bundle.objects["dashboard-executive-pulse"];
  const groupedTaskReport = bundle.objects["report-task-pipeline"];

  return {
    bundle,
    favorites: ["dashboard-executive-pulse"],
    recent: ["dashboard-executive-pulse"],
    branding: {
      platformName: "Cadence Reporting Portal",
      navigationLabel: "Reports and Dashboards",
      homeLabel: "Workspace"
    },
    quickbase: {
      realmHostname: "cadencec.quickbase.com",
      userToken: "cazjr3_rnua_0_c5r36vs4exw6v2fi93pdn9gfng",
      appToken: "",
      appId: "bva8ar4ad",
      apiBaseUrl: "https://api.quickbase.com/v1",
      objectTableId: "bvysukdeq",
      objectKeyFieldId: "3",
      objectTypeFieldId: "6",
      objectNameFieldId: "7",
      objectConfigFieldId: "8",
      objectOwnerFieldId: "",
      objectUpdatedAtFieldId: "",
      objectUpdatedByFieldId: "",
      settingsTableId: "bvysupuj7",
      settingsUserFieldId: "6",
      settingsObjectFieldId: "7",
      settingsObjectKeyFieldId: "3",
      settingsJsonFieldId: "",
      settingsUpdatedByFieldId: "",
      versionTableId: "bvysvpq8m",
      versionObjectFieldId: "6",
      versionObjectKeyFieldId: "3",
      versionSnapshotFieldId: "7",
      versionChangedAtFieldId: "8",
      versionChangedByFieldId: "",
      versionUpdatedByFieldId: ""
    },
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
      lastLoadedAt: ""
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

export function normalizeStudioDocument(input: Partial<StudioDocument> | null | undefined): StudioDocument {
  const defaults = buildStudioDocument();
  const source = input || {};
  const normalizedObjects = Object.fromEntries(
    Object.entries(source.bundle?.objects || defaults.bundle.objects).map(([id, object]) => {
      if (object.type === "report") {
        const displayLabels = object.displayLabels || {};
        const filters = object.filters || [];
        return [id, {
          ...object,
          filters,
          filterTree: object.filterTree || createFilterGroup("and", filters as FilterDefinition[]),
          view: buildReportView(object.view || {}),
          displayLabels: { fields: displayLabels.fields || {}, chartValues: displayLabels.chartValues || {} }
        }];
      }
      return [id, object];
    })
  );
  return {
    ...defaults,
    ...source,
    bundle: {
      ...defaults.bundle,
      ...(source.bundle || {}),
      app: {
        ...defaults.bundle.app,
        ...(source.bundle?.app || {})
      },
      tables: source.bundle?.tables || defaults.bundle.tables,
      data: source.bundle?.data || defaults.bundle.data,
      objects: normalizedObjects,
      order: source.bundle?.order || defaults.bundle.order
    },
    branding: {
      ...defaults.branding,
      ...(source.branding || {})
    },
    quickbase: mergeQuickbaseDefaults(defaults.quickbase, source.quickbase),
    templates: {
      layouts: source.templates?.layouts || defaults.templates.layouts,
      yaml: source.templates?.yaml || defaults.templates.yaml,
      upload: source.templates?.upload || defaults.templates.upload
    },
    versions: source.versions || defaults.versions,
    exportJobs: source.exportJobs || defaults.exportJobs,
    favorites: source.favorites || defaults.favorites,
    recent: source.recent || defaults.recent,
    sync: {
      ...defaults.sync,
      ...(source.sync || {})
    }
  };
}
