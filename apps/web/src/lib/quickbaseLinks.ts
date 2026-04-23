import { buildCombinedFilterTree, filterHasValue, type ChartDatum, type FilterDefinition, type FilterGroupDefinition, type FilterNodeDefinition, type ReportDefinition, type TableDefinition } from "@studio/shared";

export interface QuickbaseTableLinkContext {
  realmHostname: string;
  tableId: string;
}

function normalizeHostname(hostname: string) {
  return String(hostname || "").trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function escapeQuickbaseQueryValue(value: string) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function canBuildQuickbaseLinks(context: QuickbaseTableLinkContext | null | undefined) {
  return Boolean(context?.realmHostname && context?.tableId);
}

export function buildQuickbaseRecordEditUrl(context: QuickbaseTableLinkContext | null | undefined, recordId: string) {
  if (!canBuildQuickbaseLinks(context) || !recordId) return "";
  const hostname = normalizeHostname(context!.realmHostname);
  return `https://${hostname}/db/${encodeURIComponent(context!.tableId)}?a=er&rid=${encodeURIComponent(recordId)}`;
}

export function buildQuickbaseSavedReportUrl(context: QuickbaseTableLinkContext | null | undefined, reportId: string) {
  if (!canBuildQuickbaseLinks(context) || !reportId) return "";
  const hostname = normalizeHostname(context!.realmHostname);
  return `https://${hostname}/db/${encodeURIComponent(context!.tableId)}?a=q&qid=${encodeURIComponent(reportId)}`;
}

export function buildQuickbaseFilteredQueryUrl(
  context: QuickbaseTableLinkContext | null | undefined,
  fieldId: string,
  rawValue: string,
  filterTree?: FilterGroupDefinition | null
) {
  if (!canBuildQuickbaseLinks(context) || !fieldId) return "";
  const hostname = normalizeHostname(context!.realmHostname);
  const categoryQuery = buildQuickbaseFilterClause({
    id: "chart-click-category",
    fieldId,
    operator: "equals",
    value: rawValue
  });
  const treeQuery = buildQuickbaseFilterNode(filterTree);
  const query = treeQuery ? `(${treeQuery})AND${categoryQuery}` : categoryQuery;
  return `https://${hostname}/db/${encodeURIComponent(context!.tableId)}?a=q&query=${encodeURIComponent(query)}`;
}

function buildQuickbaseFilterClause(filter: FilterDefinition) {
  const operatorMap: Record<string, string> = {
    equals: "EX",
    on: "EX",
    "not-equals": "XEX",
    contains: "CT",
    "not-contains": "XCT",
    gt: "GT",
    "on-or-after": "GTE",
    gte: "GTE",
    lt: "LT",
    "on-or-before": "LTE",
    lte: "LTE"
  };
  if (filter.operator === "blank") {
    return `{\'${filter.fieldId}\'.EX.\'\'}`
  }
  if (filter.operator === "not-blank") {
    return `{\'${filter.fieldId}\'.XEX.\'\'}`
  }
  if (!filterHasValue(filter)) return "";
  const operator = operatorMap[filter.operator];
  if (!operator) return "";
  return `{\'${filter.fieldId}\'.${operator}.\'${escapeQuickbaseQueryValue(filter.value)}\'}`
}

function isGroup(node: FilterNodeDefinition): node is FilterGroupDefinition {
  return (node as FilterGroupDefinition).type === "group";
}

function buildQuickbaseFilterNode(node: FilterNodeDefinition | null | undefined): string {
  if (!node) return "";
  if (isGroup(node)) {
    const conditions = node.conditions
      .map((condition) => buildQuickbaseFilterNode(condition))
      .filter(Boolean);
    if (!conditions.length) return "";
    if (conditions.length === 1) return conditions[0];
    return `(${conditions.join(node.join === "or" ? "OR" : "AND")})`;
  }
  return buildQuickbaseFilterClause(node);
}

export function buildQuickbaseReportFilterTree(
  report: Pick<ReportDefinition, "filters" | "filterTree">,
  extraFilters: FilterDefinition[] = []
) {
  return buildCombinedFilterTree(report, extraFilters);
}

export function buildQuickbaseChartDatumUrl(
  context: QuickbaseTableLinkContext | null | undefined,
  table: TableDefinition | undefined,
  chartFieldId: string,
  datum: ChartDatum,
  filterTree?: FilterGroupDefinition | null
) {
  if (!table || !chartFieldId) return "";
  const rawValue = String(datum.rawLabel ?? datum.label ?? "");
  return buildQuickbaseFilteredQueryUrl(context, chartFieldId, rawValue, filterTree);
}
