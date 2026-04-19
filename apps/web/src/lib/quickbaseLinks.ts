import type { ChartDatum, TableDefinition } from "@studio/shared";

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

export function buildQuickbaseFilteredQueryUrl(
  context: QuickbaseTableLinkContext | null | undefined,
  fieldId: string,
  rawValue: string
) {
  if (!canBuildQuickbaseLinks(context) || !fieldId) return "";
  const hostname = normalizeHostname(context!.realmHostname);
  const query = `{\'${fieldId}\'.EX.\'${escapeQuickbaseQueryValue(rawValue)}\'}`;
  return `https://${hostname}/db/${encodeURIComponent(context!.tableId)}?a=q&query=${encodeURIComponent(query)}`;
}

export function buildQuickbaseChartDatumUrl(
  context: QuickbaseTableLinkContext | null | undefined,
  table: TableDefinition | undefined,
  chartFieldId: string,
  datum: ChartDatum
) {
  if (!table || !chartFieldId) return "";
  const rawValue = String(datum.rawLabel ?? datum.label ?? "");
  return buildQuickbaseFilteredQueryUrl(context, chartFieldId, rawValue);
}
