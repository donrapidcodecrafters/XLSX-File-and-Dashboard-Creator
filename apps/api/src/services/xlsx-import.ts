import ExcelJS from "exceljs";
import { balanceDashboardLayout, createFilterGroup, normalizeStudioDocument, type DashboardDefinition, type DataRow, type FieldDefinition, type FieldType, type ReportDefinition, type ReportViewDefinition, type RuntimeFilterDefinition, type StudioDocument, type StudioObjectScope, type TableDefinition, type WidgetDefinition } from "@studio/shared";

interface ImportedWorkbookResult {
  document: StudioDocument;
  primaryObjectId: string;
  importedObjectIds: string[];
  importedTableIds: string[];
  warnings: string[];
  review: ImportedWorkbookReview;
}

interface ImportedReportBuildResult {
  report: ReportDefinition;
  notes: string[];
}

interface ImportedDashboardBuildResult {
  dashboard: DashboardDefinition;
  notes: string[];
}

interface ImportedReportDraft {
  report: ReportDefinition;
  sheetName: string;
}

interface WorksheetRowSnapshot {
  rowNumber: number;
  values: Array<string | number | boolean | null>;
}

interface WorksheetLayoutHints {
  state: "visible" | "hidden" | "veryHidden";
  tabColor: string;
  accentColor: string;
  title: string;
  titleRowNumber: number;
  headingRowCount: number;
  headerSource: "heuristic" | "auto-filter" | "table";
  frozenRows: number;
  frozenColumns: number;
  hiddenRowCount: number;
  hiddenColumnCount: number;
  hiddenFieldLabels: string[];
  visibleColumnCount: number;
  autoFilterRange: string;
  printArea: string;
  tableName: string;
  tableRange: string;
  tableStyle: string;
  totalsRow: boolean;
  tableRowStripes: boolean;
  tableColumnStripes: boolean;
  viewStyle: "normal" | "pageLayout" | "pageBreakPreview";
  showGridLines: boolean;
  zoomScale: number;
  centeredHorizontally: boolean;
  centeredVertically: boolean;
  fitToWidth: number;
  fitToHeight: number;
  headerFooterText: string;
  imageCount: number;
  tableFocused: boolean;
  wideLayout: boolean;
  landscape: boolean;
  mergedTitle: boolean;
}

interface WorksheetStructuredTableHints {
  name: string;
  range: string;
  headerRowNumber: number;
  startColumnNumber: number;
  endColumnNumber: number;
  endRowNumber: number;
  dataEndRowNumber: number;
  style: string;
  totalsRow: boolean;
  rowStripes: boolean;
  columnStripes: boolean;
}

interface ImportedWorkbookSheetReview {
  sheetName: string;
  worksheetName?: string;
  status: "imported" | "skipped";
  headerRowNumber: number;
  rowCount: number;
  columnCount: number;
  importedTableId?: string;
  importedReportId?: string;
  notes: string[];
  substitutions: string[];
  layout?: WorksheetLayoutHints;
}

interface ImportedWorkbookReview {
  workbookName: string;
  importedAt: string;
  importedSheetCount: number;
  skippedSheetCount: number;
  dashboardCreated: boolean;
  sheets: ImportedWorkbookSheetReview[];
}

function debugImportStep(message: string) {
  if (process.env.DEBUG_XLSX_IMPORT !== "1") return;
  console.error(`[xlsx-import] ${message}`);
}

interface WorksheetRegion {
  candidateName: string;
  rows: WorksheetRowSnapshot[];
  columnNumbers: number[];
  structuredTable: WorksheetStructuredTableHints | null;
}

type WorksheetReadResult =
  | ({
      sheetName: string;
      status: "skipped";
      notes: string[];
      substitutions: string[];
      headerRowNumber: number;
      rowCount: number;
      columnCount: number;
      layout?: WorksheetLayoutHints;
    })
  | ({
      sheetName: string;
      status: "imported";
      notes: string[];
      substitutions: string[];
      headerRowNumber: number;
      rowCount: number;
      columnCount: number;
      fields: FieldDefinition[];
      rows: DataRow[];
      hiddenFieldIds: string[];
      layout: WorksheetLayoutHints;
    });

function slugify(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function uniqueId(prefix: string, seed: string, existingIds: Set<string>) {
  const base = `${prefix}-${slugify(seed) || prefix}`;
  let candidate = base;
  let counter = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  existingIds.add(candidate);
  return candidate;
}

function normalizeCellValue(value: ExcelJS.CellValue): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => String(item || "")).join(", ");
  if (typeof value === "object") {
    if ("result" in value && value.result !== undefined && value.result !== null) {
      return normalizeCellValue(value.result as ExcelJS.CellValue);
    }
    if ("text" in value && typeof value.text === "string") {
      return value.text;
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((item) => item.text || "").join("");
    }
    if ("hyperlink" in value && typeof value.hyperlink === "string") {
      return typeof value.text === "string" && value.text.trim() ? value.text : value.hyperlink;
    }
    if ("formula" in value && typeof value.formula === "string") {
      return value.formula;
    }
  }
  return String(value);
}

function inferFieldType(values: Array<string | number | boolean | null>): FieldType {
  const nonBlank = values.filter((value) => value !== null && String(value).trim() !== "");
  if (!nonBlank.length) return "text";
  if (nonBlank.every((value) => typeof value === "boolean")) return "text";
  if (nonBlank.every((value) => typeof value === "number")) return "number";
  const dates = nonBlank.filter((value) => {
    if (typeof value !== "string") return false;
    const trimmed = value.trim();
    return Boolean(trimmed) && !Number.isNaN(Date.parse(trimmed));
  });
  if (dates.length === nonBlank.length) {
    return dates.some((value) => typeof value === "string" && /t\d{2}:\d{2}/i.test(value)) ? "datetime" : "date";
  }
  return "text";
}

function isBlankCell(value: unknown) {
  return value === null || String(value).trim() === "";
}

function isDateLikeString(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (!/^\d{1,4}[\/\-]\d{1,2}([\/\-]\d{1,4})?(?:[ t]\d{1,2}:\d{2}(:\d{2})?)?$/i.test(trimmed)) {
    return false;
  }
  return !Number.isNaN(Date.parse(trimmed));
}

function isNumericLikeString(value: string) {
  const trimmed = value.trim();
  return /^[-+]?[$(]?\d[\d,\s]*(?:\.\d+)?%?\)?$/.test(trimmed);
}

function isHeaderLabelValue(value: string | number | boolean | null) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number" || typeof value === "boolean") return false;
  const trimmed = String(value).trim();
  if (!trimmed) return false;
  if (isNumericLikeString(trimmed) || isDateLikeString(trimmed)) return false;
  return true;
}

function parseCellRef(value: string) {
  const match = String(value || "").trim().match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  return {
    columnRef: match[1].toUpperCase(),
    rowNumber: Number(match[2])
  };
}

function parseRangeRef(value: string) {
  const [startRef, endRef = startRef] = String(value || "").trim().split(":");
  const start = parseCellRef(startRef);
  const end = parseCellRef(endRef);
  if (!start || !end) return null;
  return { start, end };
}

function encodeColumnRef(columnNumber: number) {
  let result = "";
  let value = Math.max(1, Math.floor(columnNumber));
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function decodeColumnRef(columnRef: string) {
  let value = 0;
  String(columnRef || "").toUpperCase().split("").forEach((character) => {
    value = (value * 26) + (character.charCodeAt(0) - 64);
  });
  return value;
}

function encodeAddress(cell: string | { row: number; column: number }) {
  if (typeof cell === "string") return cell;
  return `${encodeColumnRef(cell.column)}${cell.row}`;
}

function normalizeAutoFilterRange(autoFilter: ExcelJS.AutoFilter | undefined) {
  if (!autoFilter) return "";
  if (typeof autoFilter === "string") return autoFilter;
  return `${encodeAddress(autoFilter.from)}:${encodeAddress(autoFilter.to)}`;
}

function normalizeWorkbookColor(value: string) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (/^[0-9a-f]{8}$/i.test(normalized)) {
    return `#${normalized.slice(2).toUpperCase()}`;
  }
  if (/^[0-9a-f]{6}$/i.test(normalized)) {
    return `#${normalized.toUpperCase()}`;
  }
  return "";
}

function normalizeHeaderFooterText(value: string) {
  return String(value || "")
    .replace(/&\"[^\"]+\"/g, " ")
    .replace(/&[LCR]/g, " ")
    .replace(/&[0-9]+/g, " ")
    .replace(/&[A-Za-z]{1,2}/g, " ")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveCellAccentColor(cell: ExcelJS.Cell | undefined) {
  if (!cell?.style?.fill || cell.style.fill.type !== "pattern") return "";
  const fg = (cell.style.fill as { fgColor?: { argb?: string } }).fgColor?.argb || "";
  const bg = (cell.style.fill as { bgColor?: { argb?: string } }).bgColor?.argb || "";
  return normalizeWorkbookColor(fg) || normalizeWorkbookColor(bg);
}

function resolveWorksheetAccentColor(
  worksheet: ExcelJS.Worksheet,
  titleRowNumber: number,
  headerRowNumber: number,
  fieldColumnNumbers: number[]
) {
  const candidateRowNumbers = Array.from(new Set([titleRowNumber, headerRowNumber].filter((value) => value > 0)));
  for (const rowNumber of candidateRowNumbers) {
    const row = worksheet.getRow(rowNumber);
    for (const columnNumber of fieldColumnNumbers) {
      const color = resolveCellAccentColor(row.getCell(columnNumber));
      if (color) return color;
    }
    for (let columnNumber = 1; columnNumber <= Math.max(worksheet.actualColumnCount, fieldColumnNumbers.length || 1); columnNumber += 1) {
      const color = resolveCellAccentColor(row.getCell(columnNumber));
      if (color) return color;
    }
  }
  return "";
}

function extractRowValuesByColumnNumbers(values: Array<string | number | boolean | null>, columnNumbers: number[]) {
  return columnNumbers.map((columnNumber) => values[columnNumber - 1] ?? null);
}

function getWorksheetStructuredTableHintsList(worksheet: ExcelJS.Worksheet): WorksheetStructuredTableHints[] {
  const tables = typeof worksheet.getTables === "function"
    ? worksheet.getTables().map((entry) => Array.isArray(entry) ? entry[0] : entry)
    : [];
  if (!Array.isArray(tables) || !tables.length) return [];
  return tables
    .map((table) => {
      const runtimeTable = table as unknown as { table?: Record<string, unknown>; model?: Record<string, unknown> };
      const model = runtimeTable.table || runtimeTable.model || null;
      const parsedRange = parseRangeRef(String(model?.tableRef || model?.autoFilterRef || model?.ref || ""));
      if (!model || !parsedRange) return null;
      const columnSpan = Math.abs(decodeColumnRef(parsedRange.end.columnRef) - decodeColumnRef(parsedRange.start.columnRef));
      const rowSpan = Math.abs(parsedRange.end.rowNumber - parsedRange.start.rowNumber);
      return {
        model,
        parsedRange,
        area: (columnSpan + 1) * (rowSpan + 1)
      };
    })
    .filter((candidate): candidate is { model: Record<string, unknown>; parsedRange: NonNullable<ReturnType<typeof parseRangeRef>>; area: number } => Boolean(candidate))
    .sort((left, right) => right.area - left.area)
    .map((primary) => {
      const style = typeof primary.model.style === "object" && primary.model.style && "theme" in primary.model.style
        ? String((primary.model.style as { theme?: string }).theme || "")
        : "";
      const startColumnNumber = decodeColumnRef(primary.parsedRange.start.columnRef);
      const endColumnNumber = decodeColumnRef(primary.parsedRange.end.columnRef);
      const totalsRow = Boolean(primary.model.totalsRow);
      return {
        name: String(primary.model.name || "").trim(),
        range: `${primary.parsedRange.start.columnRef}${primary.parsedRange.start.rowNumber}:${primary.parsedRange.end.columnRef}${primary.parsedRange.end.rowNumber}`,
        headerRowNumber: primary.parsedRange.start.rowNumber,
        startColumnNumber,
        endColumnNumber,
        endRowNumber: primary.parsedRange.end.rowNumber,
        dataEndRowNumber: totalsRow ? Math.max(primary.parsedRange.start.rowNumber, primary.parsedRange.end.rowNumber - 1) : primary.parsedRange.end.rowNumber,
        style,
        totalsRow,
        rowStripes: Boolean(typeof primary.model.style === "object" && primary.model.style && "showRowStripes" in primary.model.style && (primary.model.style as { showRowStripes?: boolean }).showRowStripes),
        columnStripes: Boolean(typeof primary.model.style === "object" && primary.model.style && "showColumnStripes" in primary.model.style && (primary.model.style as { showColumnStripes?: boolean }).showColumnStripes)
      };
    });
}

function getWorksheetStructuredTableHints(worksheet: ExcelJS.Worksheet) {
  return getWorksheetStructuredTableHintsList(worksheet)[0] || null;
}

function splitNumberSeriesIntoBands(values: number[], minimumGap = 1) {
  const sorted = Array.from(new Set(values.filter((value) => value > 0))).sort((left, right) => left - right);
  if (!sorted.length) return [];
  const bands: Array<{ start: number; end: number }> = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (let index = 1; index < sorted.length; index += 1) {
    const value = sorted[index];
    if (value - previous > minimumGap) {
      bands.push({ start, end: previous });
      start = value;
    }
    previous = value;
  }
  bands.push({ start, end: previous });
  return bands;
}

function countNonBlankCells(rows: WorksheetRowSnapshot[]) {
  return rows.reduce((sum, row) => sum + row.values.filter((value) => !isBlankCell(value)).length, 0);
}

function countFormulaLikeCells(rows: WorksheetRowSnapshot[]) {
  return rows.reduce(
    (sum, row) => sum + row.values.filter((value) => typeof value === "string" && String(value).trim().startsWith("=")).length,
    0
  );
}

function buildSingleWorksheetRegion(candidateName: string, rows: WorksheetRowSnapshot[]): WorksheetRegion[] {
  const occupiedColumns = Array.from(new Set(
    rows.flatMap((row) =>
      row.values
        .map((value, index) => (!isBlankCell(value) ? index + 1 : 0))
        .filter((columnNumber) => columnNumber > 0)
    )
  )).sort((left, right) => left - right);
  if (!occupiedColumns.length) return [];
  const startColumn = occupiedColumns[0];
  const endColumn = occupiedColumns[occupiedColumns.length - 1];
  const columnNumbers = Array.from({ length: endColumn - startColumn + 1 }, (_, offset) => startColumn + offset);
  const regionRows = rows
    .map((row) => ({
      rowNumber: row.rowNumber,
      values: extractRowValuesByColumnNumbers(row.values, columnNumbers)
    }))
    .filter((row) => row.values.some((value) => !isBlankCell(value)));
  if (!regionRows.length) return [];
  return [{
    candidateName,
    rows: regionRows,
    columnNumbers: Array.from({ length: columnNumbers.length }, (_, offset) => offset + 1),
    structuredTable: null
  }];
}

function deriveWorksheetRegionName(sheetName: string, rows: WorksheetRowSnapshot[], index: number, total: number) {
  if (total <= 1) return sheetName;
  const ignoreValues = new Set(["all", "total", "grand total", "column labels", "row labels", "sum of ar"]);
  for (const row of rows.slice(0, 3)) {
    const nonBlankValues = row.values.map((value) => String(value ?? "").trim()).filter(Boolean);
    if (!nonBlankValues.length) continue;
    const firstValue = nonBlankValues[0] || "";
    if (firstValue && !ignoreValues.has(firstValue.toLowerCase())) {
      if (nonBlankValues.length === 1) {
        return `${sheetName} · ${firstValue}`;
      }
      const remainder = nonBlankValues.slice(1);
      const remainderLooksAxisLike = remainder.every((value) =>
        isNumericLikeString(value)
        || isDateLikeString(value)
        || /^[A-Za-z]{3,12}$/.test(value)
      );
      if (remainderLooksAxisLike) {
        return `${sheetName} · ${firstValue}`;
      }
    }
  }
  return `${sheetName} · Section ${index + 1}`;
}

function buildWorksheetRegions(
  worksheet: ExcelJS.Worksheet,
  rows: WorksheetRowSnapshot[]
): WorksheetRegion[] {
  const structuredTables = getWorksheetStructuredTableHintsList(worksheet);
  if (structuredTables.length) {
    return structuredTables.map((structuredTable, index) => {
      const absoluteColumnNumbers = Array.from(
        { length: structuredTable.endColumnNumber - structuredTable.startColumnNumber + 1 },
        (_, offset) => structuredTable.startColumnNumber + offset
      );
      const tableRows = rows
        .filter((row) => row.rowNumber <= structuredTable.dataEndRowNumber)
        .map((row) => ({
          rowNumber: row.rowNumber,
          values: extractRowValuesByColumnNumbers(row.values, absoluteColumnNumbers)
        }))
        .filter((row) => row.values.some((value) => !isBlankCell(value)));
      return {
        candidateName: structuredTable.name
          ? (structuredTables.length > 1 ? `${worksheet.name} · ${structuredTable.name}` : worksheet.name)
          : deriveWorksheetRegionName(worksheet.name, tableRows, index, structuredTables.length),
        rows: tableRows,
        columnNumbers: Array.from({ length: absoluteColumnNumbers.length }, (_, offset) => offset + 1),
        structuredTable
      };
    }).filter((region) => region.rows.length);
  }

  const autoFilterRange = normalizeAutoFilterRange(worksheet.autoFilter);
  const autoFilterParsedRange = parseRangeRef(autoFilterRange);
  if (autoFilterParsedRange) {
    const absoluteColumnNumbers = Array.from(
      { length: decodeColumnRef(autoFilterParsedRange.end.columnRef) - decodeColumnRef(autoFilterParsedRange.start.columnRef) + 1 },
      (_, offset) => decodeColumnRef(autoFilterParsedRange.start.columnRef) + offset
    );
    const regionRows = rows
      .filter((row) => row.rowNumber <= autoFilterParsedRange.end.rowNumber)
      .map((row) => ({
        rowNumber: row.rowNumber,
        values: extractRowValuesByColumnNumbers(row.values, absoluteColumnNumbers)
      }))
      .filter((row) => row.values.some((value) => !isBlankCell(value)));
    if (regionRows.length) {
      return [{
        candidateName: worksheet.name,
        rows: regionRows,
        columnNumbers: Array.from({ length: absoluteColumnNumbers.length }, (_, offset) => offset + 1),
        structuredTable: null
      }];
    }
  }

  const hasMergedPresentation = Array.isArray(worksheet.model?.merges) && worksheet.model.merges.length > 0;
  const hasPrintArea = Boolean(String(worksheet.pageSetup?.printArea || "").trim());
  const isHiddenWorksheet = worksheet.state === "hidden" || worksheet.state === "veryHidden";
  const occupiedColumnCount = Array.from(new Set(
    rows.flatMap((row) =>
      row.values
        .map((value, index) => (!isBlankCell(value) ? index + 1 : 0))
        .filter((columnNumber) => columnNumber > 0)
    )
  )).length;
  const looksLikeDashboardCanvas =
    rows.length >= 4
    && rows.length <= 80
    && occupiedColumnCount >= 4
    && (
      isHiddenWorksheet
      || hasMergedPresentation
      || hasPrintArea
    );
  if (looksLikeDashboardCanvas) {
    return buildSingleWorksheetRegion(worksheet.name, rows);
  }

  const rowBands = rows.reduce<WorksheetRowSnapshot[][]>((bands, row) => {
    const currentBand = bands[bands.length - 1];
    if (!currentBand || row.rowNumber - currentBand[currentBand.length - 1].rowNumber > 1) {
      bands.push([row]);
      return bands;
    }
    currentBand.push(row);
    return bands;
  }, []);
  const normalizedRowBands = rowBands.reduce<WorksheetRowSnapshot[][]>((bands, rowBand) => {
    const previousBand = bands[bands.length - 1];
    const previousMaxNonBlank = previousBand
      ? previousBand.reduce((max, row) => Math.max(max, row.values.filter((value) => !isBlankCell(value)).length), 0)
      : 0;
    const currentMaxNonBlank = rowBand.reduce((max, row) => Math.max(max, row.values.filter((value) => !isBlankCell(value)).length), 0);
    const previousLooksLikeMetadata = Boolean(previousBand && previousBand.length <= 2 && previousMaxNonBlank <= 2);
    const currentLooksLikeMainData = rowBand.length >= 2 && currentMaxNonBlank >= 2;
    if (previousBand && previousLooksLikeMetadata && currentLooksLikeMainData) {
      previousBand.push(...rowBand);
      return bands;
    }
    bands.push([...rowBand]);
    return bands;
  }, []);

  const regions: WorksheetRegion[] = [];
  normalizedRowBands.forEach((rowBand) => {
    const occupiedColumns = rowBand.flatMap((row) =>
      row.values
        .map((value, index) => (!isBlankCell(value) ? index + 1 : 0))
        .filter((columnNumber) => columnNumber > 0)
    );
    const columnBands = splitNumberSeriesIntoBands(occupiedColumns, 2);
    columnBands.forEach((band) => {
      const columnNumbers = Array.from(
        { length: band.end - band.start + 1 },
        (_, offset) => band.start + offset
      );
      const bandRows = rowBand
        .map((row) => ({
          rowNumber: row.rowNumber,
          values: extractRowValuesByColumnNumbers(row.values, columnNumbers)
        }))
        .filter((row) => row.values.some((value) => !isBlankCell(value)));
      if (!bandRows.length) return;
      const maxNonBlankCells = bandRows.reduce((max, row) => Math.max(max, row.values.filter((value) => !isBlankCell(value)).length), 0);
      if (bandRows.length < 2 && maxNonBlankCells < 2) return;
      regions.push({
        candidateName: "",
        rows: bandRows,
        columnNumbers: Array.from({ length: columnNumbers.length }, (_, offset) => offset + 1),
        structuredTable: null
      });
    });
  });

  const filteredRegions = regions.filter((region, _, currentRegions) => {
    if (currentRegions.length <= 1 || region.structuredTable) return true;
    const maxNonBlankCells = region.rows.reduce((max, row) => Math.max(max, row.values.filter((value) => !isBlankCell(value)).length), 0);
    const looksLikeMetadataOnly = region.rows.length <= 2 && maxNonBlankCells <= 2;
    return !looksLikeMetadataOnly;
  });

  return filteredRegions.map((region, index) => ({
    ...region,
    candidateName: deriveWorksheetRegionName(worksheet.name, region.rows, index, filteredRegions.length)
  }));
}

function mergedRangeTouchesRow(range: string, rowNumber: number) {
  const parsed = parseRangeRef(range);
  const start = parsed?.start;
  const end = parsed?.end;
  if (!start || !end) return false;
  const firstRow = Math.min(start.rowNumber, end.rowNumber);
  const lastRow = Math.max(start.rowNumber, end.rowNumber);
  return rowNumber >= firstRow && rowNumber <= lastRow;
}

function buildWorksheetLayoutHints(
  worksheet: ExcelJS.Worksheet,
  rows: WorksheetRowSnapshot[],
  headerRowIndex: number,
  fields: FieldDefinition[],
  fieldColumnNumbers: number[],
  headerSource: "heuristic" | "auto-filter" | "table",
  structuredTable: WorksheetStructuredTableHints | null
): { layout: WorksheetLayoutHints; hiddenFieldIds: string[] } {
  const titleRows = rows.slice(0, headerRowIndex);
  const mergedRanges = Array.isArray(worksheet.model?.merges) ? worksheet.model.merges : [];
  const titleCandidate = titleRows.find((row) => {
    const nonBlankValues = row.values.filter((value) => !isBlankCell(value));
    const distinctNonBlankValues = Array.from(new Set(nonBlankValues.map((value) => String(value ?? "").trim()).filter(Boolean)));
    if (!distinctNonBlankValues.length) return false;
    const headerLikeCount = distinctNonBlankValues.filter((value) => isHeaderLabelValue(value)).length;
    if (!headerLikeCount) return false;
    if (distinctNonBlankValues.length === 1) return distinctNonBlankValues[0].length >= 3;
    return distinctNonBlankValues.length <= 2 && mergedRanges.some((range) => mergedRangeTouchesRow(range, row.rowNumber));
  }) || null;
  const title = titleCandidate
    ? Array.from(new Set(titleCandidate.values.map((value) => String(value ?? "").trim()).filter(Boolean)))[0] || ""
    : "";
  const mergedTitle = Boolean(titleCandidate && mergedRanges.some((range) => mergedRangeTouchesRow(range, titleCandidate.rowNumber)));
  const frozenView = Array.isArray(worksheet.views)
    ? worksheet.views.find((view) => view && view.state === "frozen")
    : undefined;
  const frozenViewConfig = (frozenView || {}) as Record<string, unknown>;
  const primaryView = Array.isArray(worksheet.views) && worksheet.views.length ? worksheet.views[0] as Record<string, unknown> : {};
  const frozenRows = Math.max(0, Number(frozenViewConfig.ySplit) || 0);
  const frozenColumns = Math.max(0, Number(frozenViewConfig.xSplit) || 0);
  const state = worksheet.state || "visible";
  const tabColor = String(worksheet.properties?.tabColor?.argb || worksheet.properties?.tabColor?.theme || "").trim();
  const accentColor = resolveWorksheetAccentColor(worksheet, titleCandidate?.rowNumber || 0, rows[headerRowIndex]?.rowNumber || 0, fieldColumnNumbers);
  const hiddenFieldIds: string[] = [];
  const hiddenFieldLabels: string[] = [];
  const hiddenRowCount = rows.reduce((count, row) => count + (worksheet.getRow(row.rowNumber).hidden ? 1 : 0), 0);
  let visibleColumnCount = 0;
  let totalVisibleWidth = 0;
  fields.forEach((field, index) => {
    const column = worksheet.getColumn(fieldColumnNumbers[index] || index + 1);
    if (column.hidden) {
      hiddenFieldIds.push(field.id);
      hiddenFieldLabels.push(field.label);
      return;
    }
    visibleColumnCount += 1;
    totalVisibleWidth += Number(column.width) || 10;
  });
  const landscape = worksheet.pageSetup?.orientation === "landscape";
  const autoFilterRange = normalizeAutoFilterRange(worksheet.autoFilter);
  const printArea = String(worksheet.pageSetup?.printArea || "");
  const showGridLines = primaryView && "showGridLines" in primaryView ? Boolean(primaryView.showGridLines) : true;
  const zoomScale = Math.max(0, Number(primaryView?.zoomScale) || 100);
  const viewStyle = primaryView?.style === "pageLayout" || primaryView?.style === "pageBreakPreview"
    ? primaryView.style
    : "normal";
  const headerFooterText = [
    worksheet.headerFooter?.firstHeader,
    worksheet.headerFooter?.oddHeader,
    worksheet.headerFooter?.evenHeader,
    worksheet.headerFooter?.firstFooter,
    worksheet.headerFooter?.oddFooter,
    worksheet.headerFooter?.evenFooter
  ]
    .map((value) => normalizeHeaderFooterText(String(value || "")))
    .filter(Boolean)
    .join(" | ");
  const imageCount = typeof worksheet.getImages === "function" ? worksheet.getImages().length : 0;
  const wideLayout = landscape || visibleColumnCount >= 7 || totalVisibleWidth >= 96 || frozenColumns > 0;
  const tableFocused = Boolean(structuredTable) || Boolean(autoFilterRange) || frozenRows >= Math.max(1, headerRowIndex + 1) || Boolean(printArea);
  return {
    hiddenFieldIds,
    layout: {
      state,
      tabColor,
      accentColor,
      title,
      titleRowNumber: titleCandidate?.rowNumber || 0,
      headingRowCount: headerRowIndex,
      headerSource,
      frozenRows,
      frozenColumns,
      hiddenRowCount,
      hiddenColumnCount: hiddenFieldIds.length,
      hiddenFieldLabels,
      visibleColumnCount,
      autoFilterRange,
      printArea,
      tableName: structuredTable?.name || "",
      tableRange: structuredTable?.range || "",
      tableStyle: structuredTable?.style || "",
      totalsRow: Boolean(structuredTable?.totalsRow),
      tableRowStripes: Boolean(structuredTable?.rowStripes),
      tableColumnStripes: Boolean(structuredTable?.columnStripes),
      viewStyle,
      showGridLines,
      zoomScale,
      centeredHorizontally: Boolean(worksheet.pageSetup?.horizontalCentered),
      centeredVertically: Boolean(worksheet.pageSetup?.verticalCentered),
      fitToWidth: Math.max(0, Number(worksheet.pageSetup?.fitToWidth) || 0),
      fitToHeight: Math.max(0, Number(worksheet.pageSetup?.fitToHeight) || 0),
      headerFooterText,
      imageCount,
      tableFocused,
      wideLayout,
      landscape,
      mergedTitle
    }
  };
}

function selectHeaderRow(rows: WorksheetRowSnapshot[]) {
  const maxNonBlankCells = rows.reduce((max, row) => {
    const count = row.values.filter((value) => !isBlankCell(value)).length;
    return Math.max(max, count);
  }, 0);
  const minimumHeaderCells = maxNonBlankCells <= 1 ? 1 : 2;
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  rows.forEach((row, index) => {
    const nonBlankIndices = row.values
      .map((value, valueIndex) => (!isBlankCell(value) ? valueIndex : -1))
      .filter((valueIndex) => valueIndex >= 0);
    const nonBlankCount = nonBlankIndices.length;
    if (!nonBlankCount) return;

    const headerLikeCount = nonBlankIndices.filter((valueIndex) => isHeaderLabelValue(row.values[valueIndex])).length;
    const dataLikeCount = nonBlankCount - headerLikeCount;
    const normalizedValues = nonBlankIndices.map((valueIndex) => String(row.values[valueIndex] ?? "").trim().toLowerCase());
    const distinctValueCount = new Set(normalizedValues).size;
    const duplicatePenalty = nonBlankIndices.length - distinctValueCount;
    const laterRows = rows.slice(index + 1, index + 5);
    const supportingRowCount = laterRows.filter((candidateRow) => {
      const overlap = nonBlankIndices.filter((valueIndex) => !isBlankCell(candidateRow.values[valueIndex] ?? null)).length;
      return overlap >= Math.max(1, Math.min(nonBlankCount, 2));
    }).length;
    const typedDataBelowCount = laterRows.filter((candidateRow) =>
      nonBlankIndices.some((valueIndex) => {
        const value = candidateRow.values[valueIndex] ?? null;
        return !isBlankCell(value) && !isHeaderLabelValue(value);
      })
    ).length;

    let score = nonBlankCount * 6;
    score += headerLikeCount * 4;
    score += supportingRowCount * 5;
    score += typedDataBelowCount * 3;
    score -= dataLikeCount * 5;
    score -= duplicatePenalty * 3;

    if (nonBlankCount < minimumHeaderCells) score -= 12;
    if (!supportingRowCount) score -= 14;
    if (headerLikeCount === nonBlankCount) score += 4;
    if (distinctValueCount === 1 && nonBlankCount >= 3) score -= 20;
    if (duplicatePenalty >= Math.max(2, nonBlankCount - 1)) score -= 10;
    if (index > 0) score += Math.min(index, 2);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function buildDefaultReportView(overrides: Partial<ReportViewDefinition> = {}): ReportViewDefinition {
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

function buildImportedReport(
  name: string,
  table: TableDefinition,
  rows: DataRow[],
  layoutHints: WorksheetLayoutHints,
  hiddenFieldIds: string[],
  scope: StudioObjectScope,
  ownerUserId: string,
  importedAt: string,
  existingIds: Set<string>
) : ImportedReportBuildResult {
  const notes: string[] = [];
  const fields = table.fields;
  const visibleFields = fields.filter((field) => !hiddenFieldIds.includes(field.id));
  const preferredFields = visibleFields.length ? visibleFields : fields;
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  const fieldStats = new Map(fields.map((field) => [field.id, {
    distinctValues: new Set<string>(),
    distinctLabels: [] as string[],
    numericCount: 0,
    percentLike: true,
    hasPositive: false,
    hasNegative: false,
    descending: true,
    lastNumeric: null as number | null
  }]));
  rows.forEach((row) => {
    fields.forEach((field) => {
      const stats = fieldStats.get(field.id);
      if (!stats) return;
      const rawValue = row[field.id];
      const normalized = String(rawValue ?? "").trim();
      if (normalized) {
        stats.distinctValues.add(normalized);
      }
      const numericValue = Number(rawValue);
      if (!Number.isFinite(numericValue)) return;
      stats.numericCount += 1;
      if (numericValue < 0 || numericValue > 100) {
        stats.percentLike = false;
      }
      if (numericValue > 0) stats.hasPositive = true;
      if (numericValue < 0) stats.hasNegative = true;
      if (stats.lastNumeric !== null && numericValue > stats.lastNumeric) {
        stats.descending = false;
      }
      stats.lastNumeric = numericValue;
    });
  });
  fieldStats.forEach((stats) => {
    stats.distinctLabels = Array.from(stats.distinctValues);
  });
  const distinctCount = (fieldId: string) => fieldStats.get(fieldId)?.distinctValues.size || 0;
  const distinctLabels = (fieldId: string) => fieldStats.get(fieldId)?.distinctLabels || [];
  const isPercentLikeField = (fieldId: string) => {
    const stats = fieldStats.get(fieldId);
    return Boolean(stats && stats.numericCount > 0 && stats.percentLike);
  };
  const hasMixedDirectionField = (fieldId: string) => {
    const stats = fieldStats.get(fieldId);
    return Boolean(stats?.hasPositive && stats?.hasNegative);
  };
  const looksLikeTargetField = (fieldId: string) => {
    const field = fieldById.get(fieldId);
    return /(target|goal|quota|plan|benchmark|budget|expected)/i.test(field?.label || "");
  };
  const periodicCategoryLabel = (value: string) => {
    const normalized = String(value || "").trim().toLowerCase();
    return [
      "jan", "january", "feb", "february", "mar", "march", "apr", "april", "may", "jun", "june",
      "jul", "july", "aug", "august", "sep", "sept", "september", "oct", "october", "nov", "november", "dec", "december",
      "sun", "sunday", "mon", "monday", "tue", "tues", "tuesday", "wed", "wednesday", "thu", "thurs", "thursday", "fri", "friday", "sat", "saturday",
      "q1", "q2", "q3", "q4"
    ].includes(normalized);
  };
  const looksLikePeriodicCategory = (fieldId: string) => {
    const labels = distinctLabels(fieldId);
    return labels.length >= 3 && labels.length <= 8 && labels.every((label) => periodicCategoryLabel(label));
  };
  const stageLikeToken = (value: string) => /(lead|qualified|proposal|negotiation|contract|closed|won|lost|awareness|interest|consideration|decision|discover|design|build|test|launch|backlog|todo|doing|done|complete|planning|active|blocked)/i.test(value);
  const looksLikeFunnelCategory = (fieldId: string) => {
    const labels = distinctLabels(fieldId);
    return labels.length >= 3 && labels.length <= 8 && labels.some((label) => stageLikeToken(label));
  };
  const isDescendingField = (fieldId: string) => {
    const stats = fieldStats.get(fieldId);
    return Boolean(stats && stats.numericCount >= 3 && stats.descending);
  };
  const textFields = preferredFields.filter((field) => field.type === "text" || field.type === "user");
  const dateFields = preferredFields.filter((field) => field.type === "date" || field.type === "datetime");
  const numericFields = preferredFields.filter((field) => field.type === "number" || field.type === "currency");
  const percentLikeNumericFields = numericFields.filter((field) => isPercentLikeField(field.id));
  const countField = preferredFields[0] || fields[0];
  const titleField = textFields.find((field) => /(name|title|task|project|customer|owner|item|summary)/i.test(field.label))
    || textFields.find((field) => distinctCount(field.id) === rows.length)
    || textFields[0]
    || preferredFields[0]
    || fields[0];
  const statusField = textFields.find((field) => {
    const distinct = distinctCount(field.id);
    return /(status|stage|state|phase|priority|bucket|lane|column)/i.test(field.label)
      && distinct >= 2
      && distinct <= Math.min(8, rows.length);
  }) || null;
  const categoricalField = preferredFields.find((field) =>
    (field.type === "text" || field.type === "date" || field.type === "datetime")
    && distinctCount(field.id) >= 2
    && distinctCount(field.id) <= Math.max(2, Math.min(rows.length, 24))
  ) || preferredFields[0] || fields[0];
  const seriesField = textFields.find((field) =>
    field.id !== titleField?.id
    && field.id !== categoricalField?.id
    && distinctCount(field.id) >= 2
    && distinctCount(field.id) <= Math.min(6, rows.length - 1)
  ) || null;
  const startDateField = dateFields.find((field) => /(start|begin|open|created|from)/i.test(field.label))
    || dateFields[0]
    || null;
  const endDateField = dateFields.find((field) =>
    field.id !== startDateField?.id
    && /(end|finish|due|close|until|to)/i.test(field.label)
  ) || (dateFields.length > 1 ? dateFields.find((field) => field.id !== startDateField?.id) || null : null);
  const lowCategoryCount = categoricalField ? (distinctCount(categoricalField.id) <= 8 && rows.length <= 24) : false;
  const singleRow = rows.length === 1;
  const selectedFieldIds = Array.from(new Set([
    titleField?.id || "",
    categoricalField?.id || "",
    ...(statusField ? [statusField.id] : []),
    ...(startDateField ? [startDateField.id] : []),
    ...(endDateField ? [endDateField.id] : []),
    ...numericFields.map((field) => field.id),
    ...preferredFields.map((field) => field.id)
  ].filter(Boolean))).slice(0, Math.min(10, preferredFields.length || fields.length || 8));
  const reportId = uniqueId("report", name, existingIds);
  const summaryMetrics = [
    {
      id: `${reportId}-rows`,
      fieldId: countField?.id || selectedFieldIds[0] || "rows",
      op: "count" as const,
      label: "Rows"
    },
    ...numericFields.slice(0, 2).map((field, index) => ({
      id: `${reportId}-metric-${index + 1}`,
      fieldId: field.id,
      op: "sum" as const,
      label: field.label
    }))
  ];
  let view = buildDefaultReportView({
    mode: "table",
    showSummary: true,
    showDetails: true,
    titleFieldId: titleField?.id || selectedFieldIds[0] || ""
  });

  if (startDateField && endDateField && titleField) {
    view = buildDefaultReportView({
      mode: "timeline",
      showSummary: true,
      showDetails: true,
      titleFieldId: titleField.id,
      timelineDateField: startDateField.id,
      timelineEndField: endDateField.id
    });
    notes.push(`Inferred a timeline report from "${startDateField.label}" to "${endDateField.label}".`);
  } else if (percentLikeNumericFields.length >= 1 && singleRow) {
    const gaugeField = percentLikeNumericFields[0];
    view = buildDefaultReportView({
      mode: "chart",
      showSummary: true,
      showDetails: false,
      chartType: "gauge",
      chartFieldId: titleField?.id || countField?.id || gaugeField.id,
      chartValueFieldId: gaugeField.id,
      chartAggregation: "avg",
      titleFieldId: titleField?.id || countField?.id || gaugeField.id,
      chartTitle: name,
      chartTopN: 1,
      chartSort: "label-asc"
    });
    notes.push(`Inferred a gauge chart from a single-row percent-like value in "${gaugeField.label}".`);
  } else if (numericFields.length >= 2 && categoricalField && lowCategoryCount && looksLikeTargetField(numericFields[1].id)) {
    view = buildDefaultReportView({
      mode: "chart",
      showSummary: true,
      showDetails: true,
      chartType: "bullet",
      chartFieldId: categoricalField.id,
      chartValueFieldId: numericFields[0].id,
      chartAggregation: "sum",
      chartUseSecondaryAxis: true,
      chartSecondaryValueFieldId: numericFields[1].id,
      chartSecondaryAggregation: "sum",
      titleFieldId: titleField?.id || categoricalField.id,
      chartTitle: name,
      chartXAxisLabel: categoricalField.label,
      chartYAxisLabel: numericFields[0].label,
      chartSecondaryYAxisLabel: numericFields[1].label,
      chartTopN: 12,
      chartSort: "label-asc"
    });
    notes.push(`Inferred a bullet chart from "${numericFields[0].label}" against target-like values in "${numericFields[1].label}".`);
  } else if (numericFields.length >= 1 && categoricalField && (titleField?.id || "") === categoricalField.id && looksLikeFunnelCategory(categoricalField.id) && isDescendingField(numericFields[0].id)) {
    view = buildDefaultReportView({
      mode: "chart",
      showSummary: true,
      showDetails: true,
      chartType: "funnel",
      chartFieldId: categoricalField.id,
      chartValueFieldId: numericFields[0].id,
      chartAggregation: "sum",
      titleFieldId: titleField?.id || categoricalField.id,
      chartTitle: name,
      chartTopN: 12,
      chartSort: "label-asc"
    });
    notes.push(`Inferred a funnel chart from stage-like values in "${categoricalField.label}" and descending totals in "${numericFields[0].label}".`);
  } else if (statusField && titleField) {
    view = buildDefaultReportView({
      mode: "kanban",
      showSummary: true,
      showDetails: true,
      titleFieldId: titleField.id,
      kanbanField: statusField.id
    });
    notes.push(`Inferred a kanban report grouped by "${statusField.label}".`);
  } else if (numericFields.length >= 1 && categoricalField && seriesField && distinctCount(categoricalField.id) <= 12 && distinctCount(seriesField.id) <= 12 && rows.length <= 144) {
    view = buildDefaultReportView({
      mode: "chart",
      showSummary: true,
      showDetails: true,
      chartType: "heatmap",
      chartFieldId: categoricalField.id,
      chartSeriesFieldId: seriesField.id,
      chartValueFieldId: numericFields[0].id,
      chartAggregation: "sum",
      titleFieldId: titleField?.id || categoricalField.id,
      chartTitle: name,
      chartXAxisLabel: seriesField.label,
      chartYAxisLabel: categoricalField.label,
      chartTopN: 64,
      chartSort: "label-asc"
    });
    notes.push(`Inferred a heatmap using "${categoricalField.label}" by "${seriesField.label}" with "${numericFields[0].label}" as the cell value.`);
  } else if (percentLikeNumericFields.length >= 1 && categoricalField && lowCategoryCount && !looksLikePeriodicCategory(categoricalField.id)) {
    const progressField = percentLikeNumericFields[0];
    view = buildDefaultReportView({
      mode: "chart",
      showSummary: true,
      showDetails: true,
      chartType: distinctCount(categoricalField.id) <= 5 ? "radial-bar" : "progress-bar",
      chartFieldId: categoricalField.id,
      chartValueFieldId: progressField.id,
      chartAggregation: "avg",
      titleFieldId: titleField?.id || categoricalField.id,
      chartTitle: name,
      chartTopN: 12,
      chartSort: "label-asc"
    });
    notes.push(`Inferred a ${distinctCount(categoricalField.id) <= 5 ? "radial progress" : "progress"} chart from percent-like values in "${progressField.label}".`);
  } else if (numericFields.length >= 1 && categoricalField && looksLikePeriodicCategory(categoricalField.id)) {
    view = buildDefaultReportView({
      mode: "chart",
      showSummary: true,
      showDetails: true,
      chartType: "radar",
      chartFieldId: categoricalField.id,
      chartSeriesFieldId: seriesField?.id || "",
      chartValueFieldId: numericFields[0].id,
      chartAggregation: "sum",
      titleFieldId: titleField?.id || categoricalField.id,
      chartTitle: name,
      chartTopN: 12,
      chartSort: "label-asc"
    });
    notes.push(`Inferred a radar chart from periodic categories in "${categoricalField.label}".`);
  } else if (numericFields.length >= 1 && categoricalField && hasMixedDirectionField(numericFields[0].id) && lowCategoryCount) {
    view = buildDefaultReportView({
      mode: "chart",
      showSummary: true,
      showDetails: true,
      chartType: "waterfall",
      chartFieldId: categoricalField.id,
      chartValueFieldId: numericFields[0].id,
      chartAggregation: "sum",
      titleFieldId: titleField?.id || categoricalField.id,
      chartTitle: name,
      chartTopN: 16,
      chartSort: "label-asc"
    });
    notes.push(`Inferred a waterfall chart from positive and negative step changes in "${numericFields[0].label}".`);
  } else if (numericFields.length >= 3) {
    view = buildDefaultReportView({
      mode: "chart",
      showSummary: true,
      showDetails: true,
      chartType: "bubble",
      chartFieldId: numericFields[0].id,
      chartValueFieldId: numericFields[1].id,
      chartAggregation: "sum",
      chartUseSecondaryAxis: true,
      chartSecondaryValueFieldId: numericFields[2].id,
      chartSecondaryAggregation: "sum",
      titleFieldId: titleField?.id || numericFields[0].id,
      chartTitle: name,
      chartXAxisLabel: numericFields[0].label,
      chartYAxisLabel: numericFields[1].label,
      chartSecondaryYAxisLabel: numericFields[2].label,
      chartTopN: 24,
      chartSort: "label-asc"
    });
    notes.push(`Inferred a bubble chart using "${numericFields[0].label}" on X, "${numericFields[1].label}" on Y, and "${numericFields[2].label}" as bubble size.`);
  } else if (numericFields.length >= 2 && categoricalField) {
    const dateLikeCategory = categoricalField.type === "date" || categoricalField.type === "datetime";
    view = buildDefaultReportView({
      mode: "chart",
      showSummary: true,
      showDetails: true,
      chartType: dateLikeCategory ? "line" : "line-bar",
      chartFieldId: categoricalField.id,
      chartValueFieldId: numericFields[0].id,
      chartAggregation: "sum",
      chartUseSecondaryAxis: true,
      chartSecondaryValueFieldId: numericFields[1].id,
      chartSecondaryAggregation: "sum",
      chartSecondarySeriesType: dateLikeCategory ? "line" : "bar",
      chartSeriesFieldId: seriesField?.id || "",
      titleFieldId: titleField?.id || categoricalField.id,
      chartTitle: name,
      chartXAxisLabel: categoricalField.label,
      chartYAxisLabel: numericFields[0].label,
      chartSecondaryYAxisLabel: numericFields[1].label,
      chartTopN: 24,
      chartSort: dateLikeCategory ? "label-asc" : "value-desc"
    });
    notes.push(`Inferred a ${dateLikeCategory ? "time-series" : "dual-metric"} chart from "${categoricalField.label}" with "${numericFields[0].label}" and "${numericFields[1].label}".`);
    if (seriesField) {
      notes.push(`Grouped chart series by "${seriesField.label}".`);
    }
  } else if (numericFields.length >= 1 && categoricalField) {
    const dateLikeCategory = categoricalField.type === "date" || categoricalField.type === "datetime";
    const lowCategoryCount = distinctCount(categoricalField.id) <= 6 && rows.length <= 12;
    view = buildDefaultReportView({
      mode: "chart",
      showSummary: true,
      showDetails: true,
      chartType: dateLikeCategory ? "line" : (lowCategoryCount ? "donut" : "bar"),
      chartFieldId: categoricalField.id,
      chartSeriesFieldId: !dateLikeCategory && seriesField ? seriesField.id : "",
      chartValueFieldId: numericFields[0].id,
      chartAggregation: "sum",
      titleFieldId: titleField?.id || categoricalField.id,
      chartTitle: name,
      chartXAxisLabel: dateLikeCategory ? categoricalField.label : "",
      chartYAxisLabel: dateLikeCategory ? numericFields[0].label : "",
      chartTopN: 24,
      chartSort: dateLikeCategory ? "label-asc" : "value-desc"
    });
    notes.push(`Inferred a ${dateLikeCategory ? "line" : lowCategoryCount ? "donut" : "bar"} chart from "${categoricalField.label}" and "${numericFields[0].label}".`);
    if (!dateLikeCategory && seriesField) {
      notes.push(`Grouped chart series by "${seriesField.label}".`);
    }
  } else {
    notes.push("Imported as a detail table because no stronger chart or board pattern was detected.");
  }

  if (layoutHints.title) {
    notes.push(`Recovered source sheet title "${layoutHints.title}" from row ${layoutHints.titleRowNumber}.`);
  }
  if (layoutHints.state !== "visible") {
    notes.push(`Detected a ${layoutHints.state} worksheet and treated it as supporting workbook content.`);
  }
  if (layoutHints.tabColor) {
    notes.push(`Recovered worksheet tab color "${layoutHints.tabColor}".`);
  }
  if (layoutHints.frozenRows || layoutHints.frozenColumns) {
    notes.push(`Detected frozen panes (${layoutHints.frozenRows} frozen row${layoutHints.frozenRows === 1 ? "" : "s"}, ${layoutHints.frozenColumns} frozen column${layoutHints.frozenColumns === 1 ? "" : "s"}).`);
  }
  if (layoutHints.hiddenColumnCount) {
    notes.push(`Preserved ${layoutHints.hiddenColumnCount} hidden source column${layoutHints.hiddenColumnCount === 1 ? "" : "s"} but excluded ${layoutHints.hiddenColumnCount === 1 ? "it" : "them"} from the default visible report fields.`);
  }
  if (layoutHints.hiddenRowCount) {
    notes.push(`Recovered ${layoutHints.hiddenRowCount} hidden worksheet row${layoutHints.hiddenRowCount === 1 ? "" : "s"} as workbook presentation cues.`);
  }
  if (layoutHints.autoFilterRange) {
    notes.push(`Recovered a worksheet auto-filter range at "${layoutHints.autoFilterRange}".`);
  }
  if (layoutHints.printArea) {
    notes.push(`Recovered a worksheet print area at "${layoutHints.printArea}".`);
  }
  if (layoutHints.viewStyle !== "normal" || !layoutHints.showGridLines || layoutHints.zoomScale !== 100) {
    notes.push(`Recovered worksheet view settings (${layoutHints.viewStyle}, ${layoutHints.showGridLines ? "gridlines on" : "gridlines off"}, zoom ${layoutHints.zoomScale}%).`);
  }
  if (layoutHints.centeredHorizontally || layoutHints.centeredVertically || layoutHints.fitToWidth || layoutHints.fitToHeight) {
    const centering = [
      layoutHints.centeredHorizontally ? "h" : "",
      layoutHints.centeredVertically ? "v" : ""
    ].join("") || "none";
    notes.push(`Recovered page fit / centering cues (fit ${layoutHints.fitToWidth || "auto"}w x ${layoutHints.fitToHeight || "auto"}h, centered ${centering}).`);
  }
  if (layoutHints.headerFooterText) {
    notes.push(`Recovered worksheet header/footer text "${layoutHints.headerFooterText}".`);
  }
  if (layoutHints.imageCount) {
    notes.push(`Recovered ${layoutHints.imageCount} placed worksheet image${layoutHints.imageCount === 1 ? "" : "s"} as workbook visual cues.`);
  }
  if (layoutHints.tableFocused) {
    notes.push("Detected a table-first worksheet structure and will keep imported dashboard tabs in a table-centric reading order when needed.");
  }
  if (layoutHints.wideLayout) {
    notes.push(`Detected a ${layoutHints.landscape ? "landscape / " : ""}wide worksheet layout and will favor full-width detail cards in the reconstructed dashboard.`);
  }
  const workbookAccentColor = normalizeWorkbookColor(layoutHints.tabColor) || layoutHints.accentColor;
  if (workbookAccentColor && view.mode === "chart") {
    view = {
      ...view,
      chartColors: [workbookAccentColor, ...view.chartColors.filter((color) => color !== workbookAccentColor)]
    };
    notes.push(`${normalizeWorkbookColor(layoutHints.tabColor) ? "Applied the worksheet tab color" : "Applied the recovered worksheet accent color"} ${workbookAccentColor} as the leading chart color.`);
  }

  const report: ReportDefinition = {
    id: reportId,
    type: "report",
    schemaVersion: 1,
    name,
    description: [
      layoutHints.title
        ? `Imported from workbook sheet "${name}" with source title "${layoutHints.title}".`
        : `Imported from workbook sheet "${name}".`,
      layoutHints.headerFooterText ? `Recovered page header/footer: ${layoutHints.headerFooterText}.` : "",
      layoutHints.imageCount ? `Source sheet included ${layoutHints.imageCount} placed image${layoutHints.imageCount === 1 ? "" : "s"}.` : ""
    ].filter(Boolean).join(" "),
    folder: "Imported Workbooks",
    category: "Imported",
    tags: ["xlsx-import"],
    scope,
    ownerUserId,
    sharedUserIds: [],
    updatedAt: importedAt,
    sourceTableId: table.id,
    sourceReportOverrides: {},
    selectedFieldIds,
    filters: [],
    filterTree: createFilterGroup("and", []),
    groups: [],
    sorts: [],
    summaryMetrics,
    view,
    displayLabels: { fields: {}, chartValues: {} }
  };
  return { report, notes };
}

function sharedFieldLabelCount(leftTable: TableDefinition | undefined, rightTable: TableDefinition | undefined) {
  if (!leftTable || !rightTable) return 0;
  const leftLabels = new Set(leftTable.fields.map((field) => field.label.trim().toLowerCase()).filter(Boolean));
  return rightTable.fields.reduce((count, field) => count + (leftLabels.has(field.label.trim().toLowerCase()) ? 1 : 0), 0);
}

function titleTokenOverlap(left: string, right: string) {
  const leftTokens = new Set(String(left || "").toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3));
  const rightTokens = new Set(String(right || "").toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3));
  let overlap = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) overlap += 1;
  });
  return overlap;
}

function resolveAttachedSupportReports(
  visibleReport: ReportDefinition,
  supportReports: ReportDefinition[],
  layoutHintsByReportId: Record<string, WorksheetLayoutHints>,
  tablesById: Record<string, TableDefinition>
) {
  const visibleLayout = layoutHintsByReportId[visibleReport.id];
  const visibleTable = tablesById[visibleReport.sourceTableId];
  return supportReports.filter((supportReport) => {
    const supportLayout = layoutHintsByReportId[supportReport.id];
    const supportTable = tablesById[supportReport.sourceTableId];
    const sameTabColor = Boolean(visibleLayout?.tabColor && supportLayout?.tabColor && visibleLayout.tabColor === supportLayout.tabColor);
    const sharedLabels = sharedFieldLabelCount(visibleTable, supportTable);
    const sharedTitleTokens = titleTokenOverlap(visibleReport.name, supportReport.name);
    const score = (sameTabColor ? 4 : 0) + Math.min(3, sharedLabels) + Math.min(2, sharedTitleTokens);
    return score >= 4;
  });
}

function buildImportedDashboard(
  workbookName: string,
  importedReportDrafts: ImportedReportDraft[],
  layoutHintsByReportId: Record<string, WorksheetLayoutHints>,
  tablesById: Record<string, TableDefinition>,
  rowsByTableId: Record<string, DataRow[]>,
  scope: StudioObjectScope,
  ownerUserId: string,
  importedAt: string,
  existingIds: Set<string>
) : ImportedDashboardBuildResult {
  const MAX_OVERVIEW_SUMMARY_WIDGETS = 6;
  const MAX_OVERVIEW_SPOTLIGHTS = 2;
  const dashboardId = uniqueId("dashboard", workbookName, existingIds);
  const notes: string[] = [];
  const reports = importedReportDrafts.map((entry) => entry.report);
  const visibleReports = reports.filter((report) => {
    const state = layoutHintsByReportId[report.id]?.state || "visible";
    return state === "visible";
  });
  const supportReports = reports.filter((report) => !visibleReports.includes(report));
  const overviewReports = visibleReports.length ? visibleReports : reports;
  const overviewSummaryReports = overviewReports.slice(0, MAX_OVERVIEW_SUMMARY_WIDGETS);
  const overviewWidgets = overviewSummaryReports.map((report, index) => ({
    id: uniqueId("widget", `${report.name}-overview-${index + 1}`, existingIds),
    title: layoutHintsByReportId[report.id]?.title || report.name,
    layout: {
      w: 4,
      h: 3,
      x: ((index % 3) * 4) + 1,
      y: (Math.floor(index / 3) * 3) + 1
    },
    mode: "linked" as const,
    displayMode: "summary" as const,
    showDetails: false,
    showSummary: true,
    reportId: report.id
  }));
  const overviewSpotlights = overviewReports
    .map((report) => ({ report, layout: layoutHintsByReportId[report.id] }))
    .sort((left, right) => {
      const score = (candidate: { report: ReportDefinition }) => {
        if (candidate.report.view.mode === "chart") return 0;
        if (candidate.report.view.mode === "timeline" || candidate.report.view.mode === "kanban") return 1;
        return 2;
      };
      return score(left) - score(right) || left.report.name.localeCompare(right.report.name);
    })
    .slice(0, Math.min(MAX_OVERVIEW_SPOTLIGHTS, overviewReports.length))
    .map(({ report }, index) => ({
      id: uniqueId("widget", `${report.name}-overview-spotlight-${index + 1}`, existingIds),
      title: report.name,
      layout: {
        w: reports.length > 1 ? 6 : 12,
        h: report.view.mode === "timeline" || report.view.mode === "kanban" ? 5 : 4,
        x: index === 0 ? 1 : 7,
        y: 4
      },
      mode: "linked" as const,
      displayMode: report.view.mode === "chart" ? "chart" as const : "inherit" as const,
      showDetails: report.view.mode !== "chart",
      showSummary: true,
      reportId: report.id
    }));
  const reportsBySheet = new Map<string, ImportedReportDraft[]>();
  importedReportDrafts.forEach((entry) => {
    const key = entry.sheetName || entry.report.name;
    const current = reportsBySheet.get(key) || [];
    current.push(entry);
    reportsBySheet.set(key, current);
  });
  const visibleSheetGroups = Array.from(reportsBySheet.entries())
    .map(([sheetName, drafts]) => ({
      sheetName,
      drafts: drafts.filter((draft) => visibleReports.includes(draft.report))
    }))
    .filter((group) => group.drafts.length);
  const tabs = [
    {
      id: uniqueId("tab", `${workbookName}-overview`, existingIds),
      name: "Overview",
      widgets: [...overviewWidgets, ...overviewSpotlights]
    },
    ...visibleSheetGroups.map(({ sheetName, drafts }, index) => {
      const widgets: WidgetDefinition[] = [];
      let nextY = 1;
      const addSummaryWidget = (report: ReportDefinition, layout: WidgetDefinition["layout"], title = `${report.name} Summary`) => {
        widgets.push({
          id: uniqueId("widget", `${report.name}-${index + 1}-summary`, existingIds),
          title,
          layout,
          mode: "linked",
          displayMode: "summary",
          showDetails: false,
          showSummary: true,
          reportId: report.id
        });
      };
      const addMainWidget = (report: ReportDefinition, layout: WidgetDefinition["layout"], displayMode: WidgetDefinition["displayMode"] = "inherit", title = "") => {
        widgets.push({
          id: uniqueId("widget", `${report.name}-${index + 1}-main`, existingIds),
          title: title || layoutHintsByReportId[report.id]?.title || report.name,
          layout,
          mode: "linked",
          displayMode,
          showDetails: displayMode !== "chart",
          showSummary: true,
          reportId: report.id
        });
      };
      const addDetailWidget = (report: ReportDefinition, layout: WidgetDefinition["layout"]) => {
        widgets.push({
          id: uniqueId("widget", `${report.name}-${index + 1}-detail`, existingIds),
          title: `${report.name} Details`,
          layout,
          mode: "linked",
          displayMode: "table",
          showDetails: true,
          showSummary: false,
          reportId: report.id
        });
      };

      drafts.forEach(({ report }) => {
        const layoutHints = layoutHintsByReportId[report.id];
        const wideLayout = Boolean(layoutHints?.wideLayout);
        const tableFocused = Boolean(layoutHints?.tableFocused);
        const visualFirst = Boolean(layoutHints && (
          layoutHints.viewStyle !== "normal"
          || !layoutHints.showGridLines
          || layoutHints.centeredHorizontally
          || layoutHints.centeredVertically
          || layoutHints.imageCount
        ));
        const summaryFirst = report.view.mode === "timeline" || report.view.mode === "kanban" || (report.view.mode === "chart" && (wideLayout || visualFirst || report.view.chartType === "line" || report.view.chartType === "line-bar"));
        const wantsSummaryStrip = Boolean(report.summaryMetrics.length || report.view.showSummary);
        const startY = nextY;
        if (summaryFirst && wantsSummaryStrip) {
          addSummaryWidget(report, { w: 12, h: 3, x: 1, y: startY }, `${report.name} Highlights`);
        }
        if (report.view.mode === "chart") {
          const chartStartsAfterSummary = summaryFirst && wantsSummaryStrip ? startY + 3 : startY;
          addMainWidget(
            report,
            wideLayout || summaryFirst || tableFocused || visualFirst
              ? { w: 12, h: 5, x: 1, y: chartStartsAfterSummary }
              : { w: 8, h: 4, x: 1, y: startY },
            "chart"
          );
          if (!summaryFirst && wantsSummaryStrip) {
            addSummaryWidget(report, { w: 4, h: 3, x: 9, y: startY }, `${report.name} Highlights`);
          }
          nextY = wideLayout || summaryFirst || tableFocused || visualFirst
            ? chartStartsAfterSummary + 5
            : startY + 4;
        } else if (report.view.mode === "timeline" || report.view.mode === "kanban") {
          addMainWidget(report, { w: 12, h: 5, x: 1, y: summaryFirst && wantsSummaryStrip ? startY + 3 : startY });
          nextY = (summaryFirst && wantsSummaryStrip ? startY + 3 : startY) + 5;
        } else if (tableFocused) {
          if (wantsSummaryStrip) {
            addSummaryWidget(report, { w: 12, h: 3, x: 1, y: startY }, `${report.name} Highlights`);
          }
          addMainWidget(report, { w: 12, h: wideLayout ? 6 : 5, x: 1, y: wantsSummaryStrip ? startY + 3 : startY });
          nextY = (wantsSummaryStrip ? startY + 3 : startY) + (wideLayout ? 6 : 5);
        } else {
          addMainWidget(report, { w: wideLayout ? 12 : 9, h: wideLayout ? 5 : 4, x: 1, y: startY });
          if (wantsSummaryStrip) {
            addSummaryWidget(
              report,
              wideLayout
                ? { w: 12, h: 3, x: 1, y: startY + 5 }
                : { w: 3, h: 3, x: 10, y: startY }
            );
          }
          nextY = wideLayout ? startY + 8 : startY + 4;
        }
        if (report.view.showDetails && report.view.mode === "chart") {
          addDetailWidget(report, { w: 12, h: 4, x: 1, y: nextY });
          nextY += 4;
        }
        nextY += 1;
      });
      const attachedSupportReports = drafts.flatMap(({ report }) => resolveAttachedSupportReports(
        report,
        supportReports,
        layoutHintsByReportId,
        tablesById
      )).filter((report, idx, list) => list.findIndex((item) => item.id === report.id) === idx);
      attachedSupportReports.forEach((supportReport) => {
        widgets.push({
          id: uniqueId("widget", `${sheetName}-${supportReport.name}-support`, existingIds),
          title: `${supportReport.name} Support`,
          layout: { w: 12, h: 4, x: 1, y: nextY },
          mode: "linked",
          displayMode: "table",
          showDetails: true,
          showSummary: false,
          reportId: supportReport.id
        });
        nextY += 4;
      });

      return {
        id: uniqueId("tab", sheetName, existingIds),
        name: sheetName,
        widgets
      };
    })
  ];
  const runtimeFilters = inferImportedRuntimeFilters(reports, tablesById, rowsByTableId, existingIds);
  const dashboard: DashboardDefinition = {
    id: dashboardId,
    type: "dashboard",
    schemaVersion: 1,
    name: workbookName,
    description: `Imported from workbook "${workbookName}".`,
    folder: "Imported Workbooks",
    category: "Imported",
    tags: ["xlsx-import"],
    scope,
    ownerUserId,
    sharedUserIds: [],
    updatedAt: importedAt,
    tabs,
    runtimeFilters,
    sourceReportOverrides: {}
  };
  notes.push(`Created an overview tab with ${overviewWidgets.length} summary card${overviewWidgets.length === 1 ? "" : "s"}.`);
  if (overviewReports.length > overviewSummaryReports.length) {
    notes.push(`Limited the overview tab to the first ${overviewSummaryReports.length} summary cards so large workbook dashboards open faster.`);
  }
  if (overviewSpotlights.length) {
    notes.push(`Added ${overviewSpotlights.length} overview spotlight widget${overviewSpotlights.length === 1 ? "" : "s"} for the strongest inferred report sections.`);
  }
  notes.push("Created sheet tabs with chart/detail/summary widget layouts based on inferred report modes.");
  notes.push("Reconstructed widget grid coordinates so imported tabs keep a stable canvas layout for editing and export.");
  notes.push("Placed timeline, board, and chart sections with dedicated highlight strips when workbook-style section layouts suggested a summary-first reading order.");
  const wideSheetCount = reports.filter((report) => layoutHintsByReportId[report.id]?.wideLayout).length;
  if (wideSheetCount) {
    notes.push(`Applied wide-sheet layout reconstruction to ${wideSheetCount} tab${wideSheetCount === 1 ? "" : "s"} based on source column widths, frozen panes, or page orientation.`);
  }
  if (supportReports.length) {
    notes.push(`Kept ${supportReports.length} hidden support sheet${supportReports.length === 1 ? "" : "s"} as imported reports without adding them as primary dashboard tabs.`);
  }
  const attachedSupportCount = visibleReports.reduce((sum, report) =>
    sum + resolveAttachedSupportReports(report, supportReports, layoutHintsByReportId, tablesById).length, 0);
  if (attachedSupportCount) {
    notes.push(`Attached ${attachedSupportCount} hidden support sheet widget${attachedSupportCount === 1 ? "" : "s"} onto visible dashboard tabs using worksheet tab color and field overlap cues.`);
  }
  const tableFocusedSheetCount = reports.filter((report) => layoutHintsByReportId[report.id]?.tableFocused).length;
  if (tableFocusedSheetCount) {
    notes.push(`Used recovered worksheet filter / print structure to keep ${tableFocusedSheetCount} imported tab${tableFocusedSheetCount === 1 ? "" : "s"} in a table-centric layout.`);
  }
  const visualIntentSheetCount = reports.filter((report) => {
    const layout = layoutHintsByReportId[report.id];
    return Boolean(layout && (
      layout.viewStyle !== "normal"
      || !layout.showGridLines
      || layout.centeredHorizontally
      || layout.centeredVertically
      || layout.imageCount
      || layout.headerFooterText
    ));
  }).length;
  if (visualIntentSheetCount) {
    notes.push(`Applied recovered worksheet view / page presentation cues to ${visualIntentSheetCount} imported tab${visualIntentSheetCount === 1 ? "" : "s"} for a more authored workbook reading order.`);
  }
  if (runtimeFilters.length) {
    notes.push(`Inferred ${runtimeFilters.length} shared dashboard filter${runtimeFilters.length === 1 ? "" : "s"} from recurring sheet fields.`);
  }
  return { dashboard: balanceDashboardLayout(dashboard), notes };
}

function runtimeFilterPriority(label: string, type: FieldType) {
  const normalized = label.toLowerCase();
  let score = 0;
  if (/(status|stage|state|phase|priority)/.test(normalized)) score += 6;
  if (/(region|area|market|territory)/.test(normalized)) score += 5;
  if (/(owner|assignee|team|manager|customer)/.test(normalized)) score += 4;
  if (/(date|month|year|quarter|period)/.test(normalized)) score += 3;
  if (type === "date" || type === "datetime") score += 2;
  if (type === "text" || type === "user") score += 1;
  return score;
}

function inferImportedRuntimeFilters(
  reports: ReportDefinition[],
  tablesById: Record<string, TableDefinition>,
  rowsByTableId: Record<string, DataRow[]>,
  existingIds: Set<string>
): RuntimeFilterDefinition[] {
  const candidates = new Map<string, {
    fieldId: string;
    label: string;
    type: FieldType;
    reportIds: Set<string>;
    distinctCount: number;
  }>();

  reports.forEach((report) => {
    const table = tablesById[report.sourceTableId];
    const rows = rowsByTableId[report.sourceTableId] || [];
    if (!table || !rows.length) return;
    table.fields.forEach((field) => {
      if (!(field.type === "text" || field.type === "user" || field.type === "date" || field.type === "datetime")) return;
      const distinct = new Set(
        rows
          .map((row) => String(row[field.id] ?? "").trim())
          .filter(Boolean)
      );
      if (distinct.size < 2 || distinct.size > Math.min(18, Math.max(6, rows.length))) return;
      const current = candidates.get(field.id) || {
        fieldId: field.id,
        label: field.label,
        type: field.type,
        reportIds: new Set<string>(),
        distinctCount: distinct.size
      };
      current.reportIds.add(report.id);
      current.distinctCount = Math.max(current.distinctCount, distinct.size);
      candidates.set(field.id, current);
    });
  });

  return Array.from(candidates.values())
    .filter((candidate) => candidate.reportIds.size >= 2)
    .sort((left, right) =>
      right.reportIds.size - left.reportIds.size
      || runtimeFilterPriority(right.label, right.type) - runtimeFilterPriority(left.label, left.type)
      || left.distinctCount - right.distinctCount
      || left.label.localeCompare(right.label)
    )
    .slice(0, 4)
    .map((candidate) => ({
      id: uniqueId("runtime", candidate.label, existingIds),
      label: candidate.label,
      fieldId: candidate.fieldId,
      mode: candidate.reportIds.size === reports.length ? "global" : "selected",
      targetReportIds: candidate.reportIds.size === reports.length ? [] : Array.from(candidate.reportIds),
      defaultValue: ""
    }));
}

function readWorksheetRegion(
  worksheet: ExcelJS.Worksheet,
  candidateName: string,
  rows: WorksheetRowSnapshot[],
  fieldColumnNumbers: number[],
  structuredTable: WorksheetStructuredTableHints | null
): WorksheetReadResult {
  const notes: string[] = [];
  const substitutions: string[] = [];
  if (!rows.length) {
    const message = `Skipped "${candidateName}" because it had no usable rows.`;
    return {
      sheetName: candidateName,
      status: "skipped",
      notes: [message],
      substitutions: [],
      headerRowNumber: 0,
      rowCount: 0,
      columnCount: 0
    };
  }
  const autoFilterRange = normalizeAutoFilterRange(worksheet.autoFilter);
  const autoFilterHeaderRowNumber = parseRangeRef(autoFilterRange)?.start.rowNumber || 0;
  const autoFilterHeaderIndex = autoFilterHeaderRowNumber
    ? rows.findIndex((row) => row.rowNumber === autoFilterHeaderRowNumber)
    : -1;
  const tableHeaderIndex = structuredTable
    ? rows.findIndex((row) => row.rowNumber === structuredTable.headerRowNumber)
    : -1;
  const headerRowIndex = tableHeaderIndex >= 0 ? tableHeaderIndex : (autoFilterHeaderIndex >= 0 ? autoFilterHeaderIndex : selectHeaderRow(rows));
  const headerRow = rows[headerRowIndex];
  const headerSource: "heuristic" | "auto-filter" | "table" = tableHeaderIndex >= 0 ? "table" : (autoFilterHeaderIndex >= 0 ? "auto-filter" : "heuristic");
  const relevantRows = structuredTable
    ? rows.filter((row) => row.rowNumber >= structuredTable.headerRowNumber && row.rowNumber <= structuredTable.dataEndRowNumber)
    : rows.slice(headerRowIndex);
  const headerValues = extractRowValuesByColumnNumbers(headerRow.values, fieldColumnNumbers);
  const maxColumns = relevantRows.reduce((max, row) => Math.max(max, row.values.length), headerValues.length);
  const seenHeaders = new Set<string>();
  let blankHeaderCount = 0;
  let duplicateHeaderCount = 0;
  let nonTextHeaderCount = 0;
  const fields: FieldDefinition[] = Array.from({ length: structuredTable ? fieldColumnNumbers.length : maxColumns }, (_, index) => {
    const originalValue = headerValues[index] ?? null;
    if (isBlankCell(originalValue)) {
      blankHeaderCount += 1;
      substitutions.push(`Column ${fieldColumnNumbers[index] || index + 1} was blank and was renamed to "Column ${fieldColumnNumbers[index] || index + 1}".`);
    } else if (typeof originalValue !== "string") {
      nonTextHeaderCount += 1;
      substitutions.push(`Column ${fieldColumnNumbers[index] || index + 1} header "${String(originalValue)}" was converted to text.`);
    }
    const rawHeader = String(originalValue ?? "").trim() || `Column ${fieldColumnNumbers[index] || index + 1}`;
    let label = rawHeader;
    let suffix = 2;
    while (seenHeaders.has(label.toLowerCase())) {
      duplicateHeaderCount += 1;
      label = `${rawHeader} ${suffix}`;
      suffix += 1;
    }
    if (label !== rawHeader) {
      substitutions.push(`Duplicate header "${rawHeader}" was renamed to "${label}".`);
    }
    seenHeaders.add(label.toLowerCase());
    return {
      id: slugify(label) || `column-${index + 1}`,
      label,
      type: "text"
    };
  });
  const layoutFieldColumnNumbers = structuredTable
    ? Array.from({ length: structuredTable.endColumnNumber - structuredTable.startColumnNumber + 1 }, (_, index) => structuredTable.startColumnNumber + index)
    : fieldColumnNumbers;
  const { layout, hiddenFieldIds } = buildWorksheetLayoutHints(worksheet, rows, headerRowIndex, fields, layoutFieldColumnNumbers, headerSource, structuredTable);
  const dataRows = relevantRows.slice(1)
    .map((row) => Object.fromEntries(
      fields.map((field, index) => [field.id, extractRowValuesByColumnNumbers(row.values, fieldColumnNumbers)[index] ?? null])
    ) as DataRow)
    .filter((row) => Object.values(row).some((value) => !isBlankCell(value)));
  if (!dataRows.length) {
    const message = `Skipped "${candidateName}" because it only contained a header row.`;
    return {
      sheetName: candidateName,
      status: "skipped",
      notes: [message],
      substitutions,
      headerRowNumber: headerRow.rowNumber,
      rowCount: 0,
      columnCount: fields.length,
      layout
    };
  }
  if (headerRowIndex > 0) {
    notes.push(`Detected headers on row ${headerRow.rowNumber} after skipping ${headerRowIndex} leading workbook row${headerRowIndex === 1 ? "" : "s"}.`);
  }
  if (headerSource === "table" && layout.tableRange) {
    notes.push(`Locked the header row and imported rows from workbook table "${layout.tableName || worksheet.name}" at "${layout.tableRange}".`);
  } else if (headerSource === "auto-filter" && layout.autoFilterRange) {
    notes.push(`Locked the header row from the worksheet auto-filter range "${layout.autoFilterRange}".`);
  }
  if (blankHeaderCount || duplicateHeaderCount || nonTextHeaderCount) {
    const repairs = [
      blankHeaderCount ? `${blankHeaderCount} blank header${blankHeaderCount === 1 ? "" : "s"}` : "",
      duplicateHeaderCount ? `${duplicateHeaderCount} duplicate header${duplicateHeaderCount === 1 ? "" : "s"}` : "",
      nonTextHeaderCount ? `${nonTextHeaderCount} non-text header${nonTextHeaderCount === 1 ? "" : "s"}` : ""
    ].filter(Boolean);
    notes.push(`Normalized ${repairs.join(", ")} during import.`);
  }
  if (layout.title) {
    notes.push(`Recovered source title "${layout.title}" from row ${layout.titleRowNumber}.`);
  }
  if (layout.state !== "visible") {
    notes.push(`Detected a ${layout.state} worksheet in the source workbook.`);
  }
  if (layout.tabColor) {
    notes.push(`Recovered worksheet tab color "${layout.tabColor}".`);
  }
  if (layout.accentColor) {
    notes.push(`Recovered worksheet accent color "${layout.accentColor}".`);
  }
  if (layout.frozenRows || layout.frozenColumns) {
    notes.push(`Detected frozen panes (${layout.frozenRows} row${layout.frozenRows === 1 ? "" : "s"}, ${layout.frozenColumns} column${layout.frozenColumns === 1 ? "" : "s"}).`);
  }
  if (layout.hiddenRowCount) {
    notes.push(`Detected ${layout.hiddenRowCount} hidden worksheet row${layout.hiddenRowCount === 1 ? "" : "s"} in the source sheet.`);
  }
  if (layout.hiddenColumnCount) {
    notes.push(`Detected ${layout.hiddenColumnCount} hidden worksheet column${layout.hiddenColumnCount === 1 ? "" : "s"} in the source sheet.`);
  }
  if (layout.autoFilterRange) {
    notes.push(`Detected worksheet auto-filter range "${layout.autoFilterRange}".`);
  }
  if (layout.printArea) {
    notes.push(`Recovered worksheet print area "${layout.printArea}".`);
  }
  if (layout.tableName && layout.tableRange) {
    notes.push(`Recovered workbook table "${layout.tableName}" at "${layout.tableRange}".`);
    if (layout.tableStyle) {
      notes.push(`Recovered workbook table style "${layout.tableStyle}".`);
    }
    if (layout.totalsRow) {
      notes.push("Excluded the workbook table totals row from imported raw data.");
    }
  }
  if (layout.viewStyle !== "normal" || !layout.showGridLines || layout.zoomScale !== 100) {
    notes.push(`Recovered worksheet view settings (${layout.viewStyle}, ${layout.showGridLines ? "gridlines on" : "gridlines off"}, zoom ${layout.zoomScale}%).`);
  }
  if (layout.centeredHorizontally || layout.centeredVertically || layout.fitToWidth || layout.fitToHeight) {
    notes.push(`Recovered page fit / centering cues (fit ${layout.fitToWidth || "auto"}w x ${layout.fitToHeight || "auto"}h).`);
  }
  if (layout.headerFooterText) {
    notes.push(`Recovered worksheet header/footer text "${layout.headerFooterText}".`);
  }
  if (layout.imageCount) {
    notes.push(`Recovered ${layout.imageCount} placed worksheet image${layout.imageCount === 1 ? "" : "s"}.`);
  }
  if (layout.wideLayout) {
    notes.push(`Detected a ${layout.landscape ? "landscape / " : ""}wide worksheet layout from source formatting.`);
  }
  fields.forEach((field) => {
    field.type = inferFieldType(dataRows.map((row) => row[field.id] as string | number | boolean | null));
  });
  return {
    sheetName: candidateName,
    status: "imported",
    notes,
    substitutions,
    headerRowNumber: headerRow.rowNumber,
    rowCount: dataRows.length,
    columnCount: fields.length,
    fields,
    rows: dataRows,
    hiddenFieldIds,
    layout
  };
}

function readWorksheet(worksheet: ExcelJS.Worksheet): WorksheetReadResult[] {
  const rows: WorksheetRowSnapshot[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values = (Array.isArray(row.values) ? row.values.slice(1) : []).map((value) =>
      normalizeCellValue(value as ExcelJS.CellValue)
    );
    if (values.some((value) => !isBlankCell(value))) {
      rows.push({ rowNumber: row.number, values });
      if (process.env.DEBUG_XLSX_IMPORT === "1" && rows.length % 5000 === 0) {
        debugImportStep(`worksheet ${worksheet.name}: captured ${rows.length} row snapshot(s)`);
      }
    }
  });
  debugImportStep(`worksheet ${worksheet.name}: collected ${rows.length} non-blank row snapshot(s)`);

  if (!rows.length) {
    return [{
      sheetName: worksheet.name,
      status: "skipped",
      notes: [`Skipped "${worksheet.name}" because it had no usable rows.`],
      substitutions: [],
      headerRowNumber: 0,
      rowCount: 0,
      columnCount: 0
    }];
  }

  const regions = buildWorksheetRegions(worksheet, rows);
  debugImportStep(`worksheet ${worksheet.name}: built ${regions.length} region candidate(s)`);
  if (!regions.length) {
    return [{
      sheetName: worksheet.name,
      status: "skipped",
      notes: [`Skipped "${worksheet.name}" because no importable table or worksheet section was detected.`],
      substitutions: [],
      headerRowNumber: 0,
      rowCount: 0,
      columnCount: 0
    }];
  }

  return regions.map((region) => {
    debugImportStep(`worksheet ${worksheet.name}: reading region ${region.candidateName} with ${region.rows.length} row(s)`);
    const result = readWorksheetRegion(
      worksheet,
      region.candidateName,
      region.rows,
      region.columnNumbers,
      region.structuredTable
    );
    debugImportStep(`worksheet ${worksheet.name}: finished region ${region.candidateName}`);
    return result;
  });
}

export async function importWorkbookIntoStudioDocument(
  document: StudioDocument,
  filename: string,
  buffer: Uint8Array
): Promise<ImportedWorkbookResult> {
  debugImportStep(`start ${filename}`);
  const workbook = new ExcelJS.Workbook();
  const workbookPayload = Buffer.from(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(workbookPayload);
  debugImportStep(`loaded workbook ${filename} with ${workbook.worksheets.length} sheet(s)`);
  const warnings: string[] = [];
  const existingIds = new Set<string>([
    ...document.bundle.order,
    ...document.bundle.tables.map((table) => table.id)
  ]);
  const importedAt = new Date().toISOString();
  const ownerUserId = "";
  const scope: StudioObjectScope = "global";
  const workbookName = filename.replace(/\.xlsx$/i, "").trim() || "Imported Workbook";
  const importedTables: TableDefinition[] = [];
  const importedRows: Record<string, DataRow[]> = {};
  const importedReports: ReportDefinition[] = [];
  const sheetReviews: ImportedWorkbookSheetReview[] = [];
  const importedRowsByTableId: Record<string, DataRow[]> = {};
  const layoutHintsByReportId: Record<string, WorksheetLayoutHints> = {};

  workbook.worksheets.forEach((worksheet, index) => {
    debugImportStep(`reading worksheet ${index + 1}/${workbook.worksheets.length}: ${worksheet.name}`);
    const parsedRegions = readWorksheet(worksheet);
    debugImportStep(`worksheet ${worksheet.name} produced ${parsedRegions.length} region(s)`);
    parsedRegions.forEach((parsed, regionIndex) => {
      if (parsed.status === "skipped") {
        sheetReviews.push({
          sheetName: parsed.sheetName,
          worksheetName: worksheet.name,
          status: parsed.status,
          headerRowNumber: parsed.headerRowNumber,
          rowCount: parsed.rowCount,
          columnCount: parsed.columnCount,
          notes: parsed.notes,
          substitutions: parsed.substitutions,
          layout: parsed.layout
        });
        warnings.push(...parsed.notes.map((note) => `${parsed.sheetName}: ${note}`), ...parsed.substitutions.map((note) => `${parsed.sheetName}: ${note}`));
        return;
      }
      const tableId = uniqueId("table", `${workbookName}-${parsed.sheetName || worksheet.name || `${index + 1}-${regionIndex + 1}`}`, existingIds);
      const table: TableDefinition = {
        id: tableId,
        name: parsed.sheetName || worksheet.name || `Sheet ${index + 1}`,
        description: `Imported from workbook "${filename}".`,
        fields: parsed.fields
      };
      importedTables.push(table);
      importedRows[tableId] = parsed.rows;
      importedRowsByTableId[tableId] = parsed.rows;
      const inferred = buildImportedReport(table.name, table, parsed.rows, parsed.layout, parsed.hiddenFieldIds, scope, ownerUserId, importedAt, existingIds);
      debugImportStep(`built report ${inferred.report.name} from ${parsed.sheetName} (${parsed.rows.length} row(s))`);
      const report = inferred.report;
      importedReports.push(report);
      layoutHintsByReportId[report.id] = parsed.layout;
      sheetReviews.push({
        sheetName: parsed.sheetName,
        worksheetName: worksheet.name,
        status: parsed.status,
        headerRowNumber: parsed.headerRowNumber,
        rowCount: parsed.rowCount,
        columnCount: parsed.columnCount,
        importedTableId: table.id,
        importedReportId: report.id,
        notes: [...parsed.notes, ...inferred.notes],
        substitutions: parsed.substitutions,
        layout: parsed.layout
      });
      warnings.push(
        ...parsed.notes.map((note) => `${parsed.sheetName}: ${note}`),
        ...parsed.substitutions.map((note) => `${parsed.sheetName}: ${note}`),
        ...inferred.notes.map((note) => `${parsed.sheetName}: ${note}`)
      );
    });
  });

  if (!importedTables.length || !importedReports.length) {
    throw new Error("No importable sheets were found in this workbook.");
  }

  const nextDocument = normalizeStudioDocument({
    ...document,
    bundle: {
      ...document.bundle,
      tables: [...document.bundle.tables, ...importedTables],
      data: {
        ...document.bundle.data,
        ...importedRows
      },
      objects: {
        ...document.bundle.objects,
        ...Object.fromEntries(importedReports.map((report) => [report.id, report]))
      },
      order: [...importedReports.map((report) => report.id), ...document.bundle.order]
    }
  });

  let primaryObjectId = importedReports[0].id;
  let dashboardCreated = false;
  if (importedReports.length > 1) {
    debugImportStep(`building dashboard from ${importedReports.length} imported report(s)`);
    const importedReportDrafts = importedReports.map((report) => ({
      report,
      sheetName: sheetReviews.find((review) => review.importedReportId === report.id)?.worksheetName
        || sheetReviews.find((review) => review.importedReportId === report.id)?.sheetName
        || report.name
    }));
    const builtDashboard = buildImportedDashboard(
      workbookName,
      importedReportDrafts,
      layoutHintsByReportId,
      Object.fromEntries(importedTables.map((table) => [table.id, table])),
      importedRowsByTableId,
      scope,
      ownerUserId,
      importedAt,
      existingIds
    );
    debugImportStep(`built dashboard ${builtDashboard.dashboard.name}`);
    const dashboard = builtDashboard.dashboard;
    nextDocument.bundle.objects[dashboard.id] = dashboard;
    nextDocument.bundle.order = [dashboard.id, ...nextDocument.bundle.order];
    primaryObjectId = dashboard.id;
    dashboardCreated = true;
    warnings.unshift(
      `Created dashboard "${dashboard.name}" from ${importedReports.length} imported sheets.`,
      ...builtDashboard.notes.map((note) => `Dashboard: ${note}`)
    );
  }

  return {
    document: normalizeStudioDocument(nextDocument),
    primaryObjectId,
    importedObjectIds: [primaryObjectId, ...importedReports.map((report) => report.id)].filter((value, index, values) => values.indexOf(value) === index),
    importedTableIds: importedTables.map((table) => table.id),
    warnings,
    review: {
      workbookName,
      importedAt,
      importedSheetCount: sheetReviews.filter((sheet) => sheet.status === "imported").length,
      skippedSheetCount: sheetReviews.filter((sheet) => sheet.status === "skipped").length,
      dashboardCreated,
      sheets: sheetReviews
    }
  };
}
