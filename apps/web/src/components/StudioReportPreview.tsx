import { getReportFieldLabel, type DataRow, type ReportDefinition, type ReportRunResult, type TableDefinition } from "@studio/shared";
import { ChartPreview } from "./ChartPreview";
import {
  formatStudioReportCell,
  getChartAxisLabels,
  getChartViewportBounds,
  reportShowsChart,
  reportShowsDetails,
  reportShowsSummary
} from "./studioReportUtils";
import { ResizableDataTable } from "./ResizableDataTable";

function buildPager(page: number, totalPages: number, totalRows: number, pageSize: number, onPageChange: (page: number) => void) {
  if (totalRows <= pageSize) return null;
  return (
    <div className="link-toolbar">
      <button className="ghost-button btn-neutral" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}>Previous</button>
      <span className="micro">Page {page} of {totalPages}</span>
      <button className="ghost-button btn-neutral" disabled={page >= totalPages} onClick={() => onPageChange(Math.min(totalPages, page + 1))}>Next</button>
    </div>
  );
}

function renderDetailTable(report: ReportDefinition, table: TableDefinition, rows: DataRow[], tableShellClassName = "preview-table-shell") {
  return (
    <ResizableDataTable
      className={tableShellClassName}
      columns={report.selectedFieldIds.map((fieldId) => ({
        key: fieldId,
        label: getReportFieldLabel(report, table, fieldId)
      }))}
      rows={rows.map((row, index) => ({
        key: String(row.__recordId || index),
        cells: report.selectedFieldIds.map((fieldId) => formatStudioReportCell(row[fieldId], report, table, fieldId))
      }))}
    />
  );
}

export function StudioReportPreview({
  report,
  table,
  result,
  currentPage,
  onPageChange,
  pageSize = 100
}: {
  report: ReportDefinition;
  table: TableDefinition;
  result: ReportRunResult;
  currentPage: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
}) {
  const totalPages = Math.max(1, Math.ceil((result.totalRows || result.rows.length || 0) / pageSize));
  const page = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (page - 1) * pageSize;
  const visibleRows = result.rows.slice(startIndex, startIndex + pageSize);
  const pager = buildPager(page, totalPages, result.totalRows, pageSize, onPageChange);

  const summaryGrid = reportShowsSummary(report) && result.summary.length > 0 ? (
    <div className="summary-grid">
      {result.summary.map((item) => (
        <div className="summary-card" key={item.label}>
          <strong>{item.value}</strong>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  ) : null;

  if (report.view.mode === "summary") {
    return (
      <div className="studio-preview-stack">
        {summaryGrid}
        {reportShowsDetails(report) ? (
          <>
            {pager}
            {renderDetailTable(report, table, visibleRows)}
          </>
        ) : null}
      </div>
    );
  }

  if (reportShowsChart(report)) {
    const axisLabels = getChartAxisLabels(report, table);
    const chartBounds = getChartViewportBounds(report.view.chartType, result.chartData.length, false);
    return (
      <div className="studio-preview-stack">
        {summaryGrid}
        <div className="chart-scroll-shell">
          <div style={{ minWidth: `${chartBounds.minWidth}px`, minHeight: `${chartBounds.minHeight}px`, width: "100%", height: "100%" }}>
            <ChartPreview
              chartType={report.view.chartType}
              data={result.chartData}
              title={report.view.chartTitle}
              decimalPlaces={report.view.decimalPlaces}
              chartColors={report.view.chartColors}
              chartValueColors={report.view.chartValueColors}
              chartSort={report.view.chartSort}
              chartOrientation={report.view.chartOrientation}
              xAxisLabel={axisLabels.xAxisLabel}
              yAxisLabel={axisLabels.yAxisLabel}
              secondaryYAxisLabel={axisLabels.secondaryYAxisLabel}
              showLegend={report.view.chartShowLegend}
              showValues={report.view.chartShowValues}
              viewportHeight={chartBounds.minHeight}
            />
          </div>
        </div>
        {reportShowsDetails(report) ? (
          <>
            {pager}
            {renderDetailTable(report, table, visibleRows)}
          </>
        ) : null}
      </div>
    );
  }

  if (report.view.mode === "timeline" || report.view.mode === "calendar") {
    const dateFieldId = report.view.mode === "timeline" ? report.view.timelineDateField : report.view.calendarDateField;
    const titleFieldId = report.view.titleFieldId || report.selectedFieldIds[0];
    if (!reportShowsDetails(report)) {
      return <div className="empty-hint">Detail cards are turned off for this report.</div>;
    }
    return (
      <div className="studio-preview-stack">
        {pager}
        <div className="studio-card-grid">
          {visibleRows.map((row, index) => (
            <article className="studio-mini-card" key={index}>
              <strong>{formatStudioReportCell(row[titleFieldId], report, table, titleFieldId)}</strong>
              <span>{table.fields.find((field) => field.id === dateFieldId)?.label || "Date"}: {formatStudioReportCell(row[dateFieldId], report, table, dateFieldId)}</span>
              {report.view.mode === "timeline" && report.view.timelineEndField ? (
                <span>Ends: {formatStudioReportCell(row[report.view.timelineEndField], report, table, report.view.timelineEndField)}</span>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    );
  }

  if (report.view.mode === "kanban") {
    const fieldId = report.view.kanbanField || report.selectedFieldIds[0];
    const titleFieldId = report.view.titleFieldId || report.selectedFieldIds[0];
    if (!reportShowsDetails(report)) {
      return <div className="empty-hint">Detail cards are turned off for this report.</div>;
    }
    const columns = new Map<string, DataRow[]>();
    result.rows.forEach((row) => {
      const key = formatStudioReportCell(row[fieldId], report, table, fieldId) || "Unassigned";
      columns.set(key, [...(columns.get(key) || []), row]);
    });
    return (
      <div className="studio-preview-stack">
        {pager}
        <div className="kanban-board">
          {Array.from(new Map<string, DataRow[]>(
            Array.from(columns.entries()).map(([key, rows]) => [key, rows.slice(startIndex, startIndex + pageSize)])
          ).entries()).map(([key, rows]) => (
            <section className="kanban-column" key={key}>
              <div className="kanban-head">
                <strong>{key}</strong>
                <span>{rows.length}</span>
              </div>
              <div className="kanban-stack">
                {rows.map((row, index) => (
                  <article className="studio-mini-card" key={index}>
                    <strong>{formatStudioReportCell(row[titleFieldId], report, table, titleFieldId)}</strong>
                    {report.selectedFieldIds.slice(1, 4).map((selectedFieldId) => (
                      <span key={selectedFieldId}>{formatStudioReportCell(row[selectedFieldId], report, table, selectedFieldId)}</span>
                    ))}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="studio-preview-stack">
      {summaryGrid}
      {pager}
      {renderDetailTable(report, table, visibleRows)}
    </div>
  );
}
