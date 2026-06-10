import type {
  ChartDatum,
  DataRow,
  DataFreshnessInfo,
  FieldDefinition,
  FilterDefinition,
  FilterGroupDefinition,
  ReportDefinition,
  ReportRunResult,
  SummaryDatum,
  TableDefinition
} from "@studio/shared";
import {
  buildCombinedFilterTree,
  filterHasValue,
  formatMetricValue,
  getChartLabel,
  getDefaultPercentMode,
  getReportDecimalPlaces,
  normalizeChartAggregation
} from "@studio/shared";
import { isPostgresEnabled } from "../config/env.js";
import { pgQuery } from "../db/postgres.js";
import { isEncryptionEnabled } from "./encryption.js";
import { getSourceRecordSummary } from "./eav-record-store.js";

// ─── SQL builder helpers ──────────────────────────────────────────────────────

interface SqlBuilder {
  index: number;
  values: unknown[];
}

function bp(builder: SqlBuilder, value: unknown): string {
  builder.values.push(value);
  return `$${builder.index++}`;
}

function jsonExtract(fieldId: string, builder: SqlBuilder): string {
  return `(payload ->> ${bp(builder, fieldId)})`;
}

function numericSafe(col: string): string {
  // CASE WHEN col looks numeric THEN cast ELSE NULL END — never throws on dirty data
  return `CASE WHEN ${col} ~ '^-?[0-9]+\\.?[0-9]*$' THEN ${col}::numeric ELSE NULL END`;
}

function newBuilder(filterValues: unknown[], nextIndex: number): SqlBuilder {
  return { index: nextIndex, values: [...filterValues] };
}

// ─── Filter SQL builder ───────────────────────────────────────────────────────

function buildFilterCondition(
  filter: FilterDefinition,
  builder: SqlBuilder,
  fieldTypes: Map<string, string>
): string {
  const op = filter.operator;
  // Field-to-field comparisons are handled by the fallback (in-memory) path
  if (filter.valueSource === "field" && filter.compareFieldId) return "__FIELD_COMPARE__";

  const col = jsonExtract(filter.fieldId, builder);
  const fieldType = fieldTypes.get(filter.fieldId) || "text";
  const isNumeric = fieldType === "number" || fieldType === "currency";
  const isDate = fieldType === "date" || fieldType === "datetime";

  if (op === "blank") return `(${col} IS NULL OR ${col} = '')`;
  if (op === "not-blank") return `(${col} IS NOT NULL AND ${col} <> '')`;

  const rawValue = String(filter.value ?? "").trim();
  if (!rawValue) return "TRUE";

  // Date tokens
  if (rawValue === "CURRENT_MONTH") {
    return `(${col} IS NOT NULL AND ${col} <> '' AND DATE_TRUNC('month', ${col}::date) = DATE_TRUNC('month', NOW()))`;
  }
  if (rawValue === "CURRENT_YEAR") {
    return `(${col} IS NOT NULL AND ${col} <> '' AND DATE_TRUNC('year', ${col}::date) = DATE_TRUNC('year', NOW()))`;
  }
  if (rawValue === "LAST_30_DAYS") {
    return `(${col} IS NOT NULL AND ${col} <> '' AND ${col}::date BETWEEN (NOW() - INTERVAL '30 days')::date AND CURRENT_DATE)`;
  }

  if (op === "contains") return `${col} ILIKE ${bp(builder, `%${rawValue}%`)}`;
  if (op === "not-contains") return `(${col} IS NULL OR ${col} NOT ILIKE ${bp(builder, `%${rawValue}%`)})`;

  if (op === "on" || op === "on-or-after" || op === "on-or-before") {
    const sqlOp = op === "on" ? "=" : op === "on-or-after" ? ">=" : "<=";
    const vp = bp(builder, rawValue);
    return `(${col} IS NOT NULL AND ${col} <> '' AND ${col}::date ${sqlOp} ${vp}::date)`;
  }

  if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
    const sqlOp = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[op]!;
    if (isNumeric) {
      const vp = bp(builder, rawValue);
      return `${numericSafe(col)} ${sqlOp} ${vp}::numeric`;
    }
    if (isDate) {
      const vp = bp(builder, rawValue);
      return `(${col} IS NOT NULL AND ${col} <> '' AND ${col}::date ${sqlOp} ${vp}::date)`;
    }
    // Fall back to text comparison for unknown types
    return `${col} ${sqlOp} ${bp(builder, rawValue)}`;
  }

  if (op === "not-equals") {
    if (isNumeric) {
      const vp = bp(builder, rawValue);
      return `(${col} IS NULL OR ${numericSafe(col)} <> ${vp}::numeric)`;
    }
    return `(${col} IS NULL OR ${col} <> ${bp(builder, rawValue)})`;
  }

  // Default: equals
  if (isNumeric) {
    const vp = bp(builder, rawValue);
    return `${numericSafe(col)} = ${vp}::numeric`;
  }
  return `${col} = ${bp(builder, rawValue)}`;
}

function buildFilterNode(
  node: FilterGroupDefinition | FilterDefinition,
  builder: SqlBuilder,
  fieldTypes: Map<string, string>
): string {
  if ((node as FilterGroupDefinition).type === "group") {
    const group = node as FilterGroupDefinition;
    const active = group.conditions.filter((cond) => {
      if ((cond as FilterGroupDefinition).type === "group") {
        return ((cond as FilterGroupDefinition).conditions || []).length > 0;
      }
      return filterHasValue(cond as FilterDefinition);
    });
    if (!active.length) return "TRUE";
    const parts = active.map((cond) => buildFilterNode(cond as FilterGroupDefinition | FilterDefinition, builder, fieldTypes));
    if (parts.some((p) => p === "__FIELD_COMPARE__")) return "__FIELD_COMPARE__";
    return `(${parts.join(group.join === "or" ? " OR " : " AND ")})`;
  }
  return buildFilterCondition(node as FilterDefinition, builder, fieldTypes);
}

function buildFilterSql(
  filterTree: FilterGroupDefinition | null,
  fieldTypes: Map<string, string>
): { sql: string; values: unknown[]; nextIndex: number } | null {
  const builder: SqlBuilder = { index: 1, values: [] };
  const sql = filterTree ? buildFilterNode(filterTree, builder, fieldTypes) : "TRUE";
  if (sql === "__FIELD_COMPARE__") return null; // can't push field-to-field comparisons to SQL
  return { sql, values: builder.values, nextIndex: builder.index };
}

// ─── Sort clause builder ──────────────────────────────────────────────────────

function buildSortClause(report: ReportDefinition, builder: SqlBuilder, fieldTypes: Map<string, string>): string {
  if (!report.sorts.length) return "";
  const parts = report.sorts.map((sort) => {
    const col = jsonExtract(sort.fieldId, builder);
    const dir = sort.direction === "desc" ? "DESC" : "ASC";
    const fieldType = fieldTypes.get(sort.fieldId) || "text";
    if (fieldType === "number" || fieldType === "currency") {
      return `${numericSafe(col)} ${dir} NULLS LAST`;
    }
    if (fieldType === "date" || fieldType === "datetime") {
      return `CASE WHEN ${col} IS NOT NULL AND ${col} <> '' THEN ${col}::date ELSE NULL END ${dir} NULLS LAST`;
    }
    return `${col} ${dir} NULLS LAST`;
  });
  return `ORDER BY ${parts.join(", ")}`;
}

// ─── Chart result builder (SQL version) ──────────────────────────────────────

type ChartSqlRow = {
  cat: string;
  series: string | null;
  cnt: string;
  prim_sum: string | null;
  prim_avg: string | null;
  prim_min: string | null;
  prim_max: string | null;
  sec_sum: string | null;
  sec_min: string | null;
  sec_max: string | null;
};

type BuiltChartEntry = {
  label: string;
  rawLabel: string;
  value: number;
  series?: string;
  rawSeries?: string;
  axis: "primary" | "secondary";
};

function buildSqlChartData(sqlRows: ChartSqlRow[], report: ReportDefinition): ChartDatum[] {
  const aggregation = normalizeChartAggregation(report.view.chartAggregation || "count");
  const secondaryEnabled = report.view.chartUseSecondaryAxis && Boolean(report.view.chartSecondaryValueFieldId);
  const secondaryAggregation = normalizeChartAggregation(report.view.chartSecondaryAggregation || "sum");

  function pickPrimary(row: ChartSqlRow): number {
    if (aggregation === "count") return Number(row.cnt) || 0;
    if (aggregation === "sum" || aggregation === "percent") return Number(row.prim_sum) || 0;
    if (aggregation === "average") return Number(row.prim_avg) || 0;
    if (aggregation === "min") return row.prim_min !== null ? Number(row.prim_min) : 0;
    return row.prim_max !== null ? Number(row.prim_max) : 0;
  }

  function pickSecondary(row: ChartSqlRow): number {
    if (secondaryAggregation === "count") return Number(row.cnt) || 0;
    if (secondaryAggregation === "sum" || secondaryAggregation === "percent") return Number(row.sec_sum) || 0;
    if (secondaryAggregation === "average") {
      const cnt = Number(row.cnt) || 1;
      return (Number(row.sec_sum) || 0) / cnt;
    }
    if (secondaryAggregation === "min") return row.sec_min !== null ? Number(row.sec_min) : 0;
    return row.sec_max !== null ? Number(row.sec_max) : 0;
  }

  const entries: BuiltChartEntry[] = [];
  for (const row of sqlRows) {
    const rawLabel = row.cat ?? "";
    const rawSeries = row.series ?? "";
    entries.push({
      label: getChartLabel(report, rawLabel),
      rawLabel,
      value: pickPrimary(row),
      series: rawSeries ? getChartLabel(report, rawSeries) : undefined,
      rawSeries: rawSeries || undefined,
      axis: "primary"
    });
    if (secondaryEnabled) {
      entries.push({
        label: getChartLabel(report, rawLabel),
        rawLabel,
        value: pickSecondary(row),
        series: rawSeries ? getChartLabel(report, rawSeries) : undefined,
        rawSeries: rawSeries || undefined,
        axis: "secondary"
      });
    }
  }

  // Percent normalization
  const percentMode = report.view.chartPercentMode || getDefaultPercentMode(report.view.chartType);
  if (aggregation === "percent") {
    const primaries = entries.filter((e) => e.axis === "primary");
    const grandTotal = primaries.reduce((s, e) => s + e.value, 0) || 1;
    const groupTotals = new Map<string, number>();
    for (const e of primaries) groupTotals.set(e.rawLabel, (groupTotals.get(e.rawLabel) || 0) + e.value);
    for (const e of primaries) {
      const denom = percentMode === "percent_of_stack" || percentMode === "percent_of_group"
        ? (groupTotals.get(e.rawLabel) || 1) : grandTotal;
      e.value = denom ? (e.value / denom) * 100 : 0;
    }
  }
  if (secondaryEnabled && secondaryAggregation === "percent") {
    const secs = entries.filter((e) => e.axis === "secondary");
    const grandTotal = secs.reduce((s, e) => s + e.value, 0) || 1;
    const groupTotals = new Map<string, number>();
    for (const e of secs) groupTotals.set(e.rawLabel, (groupTotals.get(e.rawLabel) || 0) + e.value);
    for (const e of secs) {
      const denom = percentMode === "percent_of_stack" || percentMode === "percent_of_group"
        ? (groupTotals.get(e.rawLabel) || 1) : grandTotal;
      e.value = denom ? (e.value / denom) * 100 : 0;
    }
  }

  // Group by category for sorting and topN
  const groupedByCategory = new Map<string, BuiltChartEntry[]>();
  for (const entry of entries) {
    const existing = groupedByCategory.get(entry.rawLabel) || [];
    existing.push(entry);
    groupedByCategory.set(entry.rawLabel, existing);
  }

  const sort = report.view.chartSort || "value-desc";
  const topN = Math.max(0, Number(report.view.chartTopN) || 0);
  const categoryValue = (catEntries: BuiltChartEntry[]) =>
    catEntries.filter((e) => e.axis === "primary").reduce((s, e) => s + e.value, 0);

  const isContinuous = ["line", "area", "line-bar", "spline", "area-spline", "streamgraph", "scatter", "bubble", "3d-scatter"].includes(report.view.chartType || "");

  function compareCategories(left: string, right: string): number {
    const leftLabel = getChartLabel(report, left);
    const rightLabel = getChartLabel(report, right);
    const lt = Date.parse(left) || Date.parse(leftLabel);
    const rt = Date.parse(right) || Date.parse(rightLabel);
    if (Number.isFinite(lt) && Number.isFinite(rt)) return lt - rt;
    return (left || leftLabel).localeCompare(right || rightLabel, undefined, { numeric: true });
  }

  if (isContinuous) {
    const descending = sort === "label-desc";
    const ordered = Array.from(groupedByCategory.entries())
      .filter(([rawLabel]) => String(rawLabel ?? "").trim())
      .sort(([l], [r]) => compareCategories(l, r) * (descending ? -1 : 1));
    const trimmed = topN ? (descending ? ordered.slice(0, topN) : ordered.slice(-topN)) : ordered;
    return trimmed.flatMap(([, entrs]) => entrs) as ChartDatum[];
  }

  const rows = Array.from(groupedByCategory.entries());
  if (sort === "value-asc") rows.sort(([, l], [, r]) => categoryValue(l) - categoryValue(r));
  else if (sort === "label-asc") rows.sort(([l], [r]) => getChartLabel(report, l).localeCompare(getChartLabel(report, r), undefined, { numeric: true }));
  else if (sort === "label-desc") rows.sort(([l], [r]) => getChartLabel(report, r).localeCompare(getChartLabel(report, l), undefined, { numeric: true }));
  else rows.sort(([, l], [, r]) => categoryValue(r) - categoryValue(l));

  const trimmed = topN ? rows.slice(0, topN) : rows;
  return trimmed.flatMap(([, entrs]) => entrs) as ChartDatum[];
}

// ─── Row projection ───────────────────────────────────────────────────────────

function projectSqlRows(report: ReportDefinition, rows: DataRow[]): DataRow[] {
  const titleField = report.view.titleFieldId || report.selectedFieldIds[0] || "";
  return rows.map((row) => {
    const next: DataRow = {};
    for (const fieldId of report.selectedFieldIds) {
      next[fieldId] = row[fieldId] ?? "";
    }
    return {
      ...(row.__recordId ? { __recordId: row.__recordId } : {}),
      ...(titleField ? { __title: next[titleField] ?? "" } : {}),
      ...next
    };
  });
}

// ─── Prerequisite check ───────────────────────────────────────────────────────

async function resolveSourceId(table: TableDefinition): Promise<string | null> {
  if (!isPostgresEnabled() || isEncryptionEnabled()) return null;
  const summary = await getSourceRecordSummary(
    Array.from(new Set([table.id, table.quickbaseTableId || ""].filter(Boolean)))
  ).catch(() => null);
  if (!summary || summary.rowCount <= 0) return null;
  return summary.sourceId;
}

// ─── Main SQL execution — full report (count + aggregates + chart + page) ────

export async function trySqlExecuteDurableReport(
  report: ReportDefinition,
  table: TableDefinition,
  extraFilters: FilterDefinition[],
  options: { page: number; pageSize: number; includeRows: boolean; startIndex: number; endIndexExclusive: number },
  fresh: DataFreshnessInfo
): Promise<ReportRunResult | null> {
  if (report.sourceJoins?.length) return null;

  const sourceId = await resolveSourceId(table);
  if (!sourceId) return null;

  const fieldTypes = new Map(table.fields.map((f) => [f.id, f.type as string]));
  const filterTree = buildCombinedFilterTree(report, extraFilters) as FilterGroupDefinition | null;
  const filterResult = buildFilterSql(filterTree, fieldTypes);
  if (!filterResult) return null; // has field-to-field comparison — use in-memory fallback
  const { sql: filterSql, values: filterValues, nextIndex } = filterResult;

  // 1. COUNT(*)
  const countBld = newBuilder(filterValues, nextIndex);
  const srcCountP = bp(countBld, sourceId);
  const countResult = await pgQuery<{ total: string }>(
    `SELECT COUNT(*) AS total FROM app_records WHERE source_id = ${srcCountP} AND (${filterSql})`,
    countBld.values
  ).catch(() => null);
  if (!countResult) return null;
  const totalRows = Number(countResult.rows[0]?.total || 0);

  const decimalPlaces = getReportDecimalPlaces(report);
  const metricSet = report.summaryMetrics.length
    ? report.summaryMetrics
    : [{ id: "default-count", fieldId: report.selectedFieldIds[0] || "recordId", op: "count" as const, label: "Rows" }];

  // 2. Summary metrics — single aggregation query
  const summaryData: SummaryDatum[] = await (async () => {
    const aggBld = newBuilder(filterValues, nextIndex);
    const srcAggP = bp(aggBld, sourceId);
    const selects: string[] = [];
    const aliases: Array<{ metric: typeof metricSet[number]; alias: string }> = [];

    for (let i = 0; i < metricSet.length; i++) {
      const metric = metricSet[i];
      const alias = `m${i}`;
      if (metric.op === "count") {
        selects.push(`COUNT(*) AS ${alias}`);
      } else {
        const col = jsonExtract(metric.fieldId, aggBld);
        const numCol = numericSafe(col);
        if (metric.op === "sum") selects.push(`COALESCE(SUM(${numCol}), 0) AS ${alias}`);
        else if (metric.op === "avg") selects.push(`COALESCE(AVG(${numCol}), 0) AS ${alias}`);
        else if (metric.op === "min") selects.push(`COALESCE(MIN(${numCol}), 0) AS ${alias}`);
        else if (metric.op === "max") selects.push(`COALESCE(MAX(${numCol}), 0) AS ${alias}`);
        else selects.push(`COUNT(*) AS ${alias}`);
      }
      aliases.push({ metric, alias });
    }

    const aggResult = await pgQuery(
      `SELECT ${selects.join(", ")} FROM app_records WHERE source_id = ${srcAggP} AND (${filterSql})`,
      aggBld.values
    ).catch(() => null);
    if (!aggResult?.rows[0]) return [];

    const row = aggResult.rows[0] as Record<string, string>;
    return aliases.map(({ metric, alias }) => {
      const numericValue = Number(row[alias]) || 0;
      return {
        label: metric.label,
        value: formatMetricValue(numericValue, metric.op, decimalPlaces),
        numericValue
      };
    });
  })();

  // 3. Chart data — GROUP BY query
  const chartData: ChartDatum[] = await (async () => {
    const chartField = report.view.chartFieldId || report.groups[0]?.fieldId || report.selectedFieldIds[0] || "";
    if (!chartField) return [];

    const chartBld = newBuilder(filterValues, nextIndex);
    const srcChartP = bp(chartBld, sourceId);
    const catP = bp(chartBld, chartField);
    const catCol = `(payload ->> ${catP})`;

    const seriesField = report.view.chartSeriesFieldId || "";
    const seriesP = seriesField ? bp(chartBld, seriesField) : null;
    const seriesCol = seriesP ? `(payload ->> ${seriesP})` : null;

    const primaryValueField = report.view.chartValueFieldId || "";
    const secValueField = report.view.chartUseSecondaryAxis ? (report.view.chartSecondaryValueFieldId || "") : "";

    const selects = [
      `COALESCE(${catCol}, '') AS cat`,
      seriesCol ? `COALESCE(${seriesCol}, '') AS series` : `'' AS series`,
      `COUNT(*) AS cnt`
    ];

    if (primaryValueField) {
      const vP = bp(chartBld, primaryValueField);
      const numCol = `CASE WHEN (payload ->> ${vP}) ~ '^-?[0-9]+\\.?[0-9]*$' THEN (payload ->> ${vP})::numeric ELSE NULL END`;
      selects.push(`COALESCE(SUM(${numCol}), 0) AS prim_sum`);
      selects.push(`COALESCE(AVG(${numCol}), 0) AS prim_avg`);
      selects.push(`MIN(${numCol}) AS prim_min`);
      selects.push(`MAX(${numCol}) AS prim_max`);
    } else {
      selects.push(`0 AS prim_sum`, `0 AS prim_avg`, `NULL AS prim_min`, `NULL AS prim_max`);
    }

    if (secValueField) {
      const svP = bp(chartBld, secValueField);
      const secNumCol = `CASE WHEN (payload ->> ${svP}) ~ '^-?[0-9]+\\.?[0-9]*$' THEN (payload ->> ${svP})::numeric ELSE NULL END`;
      selects.push(`COALESCE(SUM(${secNumCol}), 0) AS sec_sum`);
      selects.push(`MIN(${secNumCol}) AS sec_min`);
      selects.push(`MAX(${secNumCol}) AS sec_max`);
    } else {
      selects.push(`0 AS sec_sum`, `NULL AS sec_min`, `NULL AS sec_max`);
    }

    const groupByCols = [catCol];
    if (seriesCol) groupByCols.push(seriesCol);

    const chartSql = [
      `SELECT ${selects.join(", ")}`,
      `FROM app_records`,
      `WHERE source_id = ${srcChartP} AND (${filterSql})`,
      `GROUP BY ${groupByCols.join(", ")}`,
      `LIMIT 5000`
    ].join(" ");

    const chartResult = await pgQuery<ChartSqlRow>(chartSql, chartBld.values).catch(() => null);
    if (!chartResult) return [];
    return buildSqlChartData(chartResult.rows, report);
  })();

  // 4. Paginated rows
  const pageRows: DataRow[] = await (async () => {
    if (!options.includeRows || totalRows === 0) return [];
    const pageBld = newBuilder(filterValues, nextIndex);
    const srcPageP = bp(pageBld, sourceId);
    const sortClause = buildSortClause(report, pageBld, fieldTypes);
    const limitP = bp(pageBld, options.pageSize);
    const offsetP = bp(pageBld, options.startIndex);

    const pageSql = [
      `SELECT payload FROM app_records`,
      `WHERE source_id = ${srcPageP} AND (${filterSql})`,
      sortClause,
      `LIMIT ${limitP} OFFSET ${offsetP}`
    ].filter(Boolean).join(" ");

    const pageResult = await pgQuery<{ payload: DataRow }>(pageSql, pageBld.values).catch(() => null);
    if (!pageResult) return [];
    return pageResult.rows.map((r) => r.payload);
  })();

  return {
    reportId: report.id,
    tableId: table.id,
    totalRows,
    rows: projectSqlRows(report, pageRows),
    summary: summaryData,
    chartData,
    warnings: [],
    page: options.page,
    pageSize: options.pageSize,
    totalPages: Math.max(1, Math.ceil(totalRows / options.pageSize)),
    hasNextPage: options.page * options.pageSize < totalRows,
    freshness: fresh
  };
}

// ─── Page-only SQL execution (no aggregates, supports sorts) ─────────────────

export async function trySqlExecuteDurablePageOnly(
  report: ReportDefinition,
  table: TableDefinition,
  extraFilters: FilterDefinition[],
  options: { page: number; pageSize: number; includeRows: boolean; startIndex: number; endIndexExclusive: number },
  fresh: DataFreshnessInfo
): Promise<ReportRunResult | null> {
  if (report.sourceJoins?.length) return null;

  const sourceId = await resolveSourceId(table);
  if (!sourceId) return null;

  const fieldTypes = new Map(table.fields.map((f) => [f.id, f.type as string]));
  const filterTree = buildCombinedFilterTree(report, extraFilters) as FilterGroupDefinition | null;
  const filterResult = buildFilterSql(filterTree, fieldTypes);
  if (!filterResult) return null;
  const { sql: filterSql, values: filterValues, nextIndex } = filterResult;

  // COUNT(*)
  const countBld = newBuilder(filterValues, nextIndex);
  const srcCountP = bp(countBld, sourceId);
  const countResult = await pgQuery<{ total: string }>(
    `SELECT COUNT(*) AS total FROM app_records WHERE source_id = ${srcCountP} AND (${filterSql})`,
    countBld.values
  ).catch(() => null);
  if (!countResult) return null;
  const totalRows = Number(countResult.rows[0]?.total || 0);

  // Paginated rows
  const pageRows: DataRow[] = await (async () => {
    if (!options.includeRows || totalRows === 0) return [];
    const pageBld = newBuilder(filterValues, nextIndex);
    const srcPageP = bp(pageBld, sourceId);
    const sortClause = buildSortClause(report, pageBld, fieldTypes);
    const limitP = bp(pageBld, options.pageSize);
    const offsetP = bp(pageBld, options.startIndex);

    const pageSql = [
      `SELECT payload FROM app_records`,
      `WHERE source_id = ${srcPageP} AND (${filterSql})`,
      sortClause,
      `LIMIT ${limitP} OFFSET ${offsetP}`
    ].filter(Boolean).join(" ");

    const pageResult = await pgQuery<{ payload: DataRow }>(pageSql, pageBld.values).catch(() => null);
    if (!pageResult) return [];
    return pageResult.rows.map((r) => r.payload);
  })();

  return {
    reportId: report.id,
    tableId: table.id,
    totalRows,
    rows: projectSqlRows(report, pageRows),
    summary: [],
    chartData: [],
    warnings: [],
    page: options.page,
    pageSize: options.pageSize,
    totalPages: Math.max(1, Math.ceil(totalRows / options.pageSize)),
    hasNextPage: options.page * options.pageSize < totalRows,
    freshness: fresh
  };
}
