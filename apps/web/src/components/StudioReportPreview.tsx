import { useState } from "react";
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
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth());
  const totalPages = Math.max(1, Math.ceil((result.totalRows || result.rows.length || 0) / pageSize));
  const page = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (page - 1) * pageSize;
  const visibleRows = result.rows.slice(startIndex, startIndex + pageSize);
  const pager = buildPager(page, totalPages, result.totalRows, pageSize, onPageChange);

  const summaryGrid = reportShowsSummary(report) && (result.crosstab || result.summary.length > 0) ? (
    result.crosstab ? (
      <div className="pivot-table-shell">
        <table className="pivot-table">
          <thead>
            <tr>
              <th className="pivot-metric-col"></th>
              {result.crosstab.columns.map((col, i) => (
                <th key={i} className={col === "Grand Total" ? "pivot-grand-total" : ""}>{col || "(blank)"}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.crosstab.rows.map((row) => (
              <tr key={row.label}>
                <td className="pivot-row-header">{row.label}</td>
                {row.formatted.map((val, i) => (
                  <td key={i} className={result.crosstab!.columns[i] === "Grand Total" ? "pivot-grand-total" : ""}>{val}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="summary-grid">
        {result.summary.map((item) => (
          <div className="summary-card" key={item.label}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    )
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

  if (report.view.mode === "timeline") {
    if (!reportShowsDetails(report)) {
      return <div className="empty-hint">Detail cards are turned off for this report.</div>;
    }
    const startFieldId = report.view.timelineDateField;
    const endFieldId = report.view.timelineEndField;
    const titleFieldId = report.view.titleFieldId || report.selectedFieldIds[0];
    const parsedItems = result.rows.map((row) => {
      const startRaw = row[startFieldId];
      const endRaw = endFieldId ? row[endFieldId] : null;
      const startDate = startRaw != null ? new Date(String(startRaw)) : null;
      const endDate = endRaw != null ? new Date(String(endRaw)) : null;
      const validStart = startDate !== null && !isNaN(startDate.getTime());
      const validEnd = endDate !== null && !isNaN(endDate.getTime());
      return {
        title: formatStudioReportCell(row[titleFieldId], report, table, titleFieldId),
        start: validStart ? startDate! : null as null,
        end: validEnd ? endDate! : (validStart ? new Date(startDate!.getTime() + 86_400_000) : null as null),
      };
    }).filter((item): item is { title: string; start: Date; end: Date } => item.start !== null && item.end !== null);
    parsedItems.sort((a, b) => a.start.getTime() - b.start.getTime());
    if (!parsedItems.length) {
      return <div className="empty">No records have a valid timeline date.</div>;
    }
    const tMin = parsedItems[0].start.getTime();
    const tMax = parsedItems.reduce((m, item) => Math.max(m, item.end.getTime()), tMin) + 86_400_000;
    const tSpan = tMax - tMin || 1;
    const toLeftPct = (ms: number) => ((ms - tMin) / tSpan) * 100;
    const toWidthPct = (s: number, e: number) => Math.max(0.5, ((e - s) / tSpan) * 100);
    const monthMarkers: { label: string; leftPct: number }[] = [];
    const mc = new Date(tMin);
    mc.setDate(1); mc.setHours(0, 0, 0, 0);
    while (mc.getTime() < tMax) {
      const lp = toLeftPct(mc.getTime());
      if (lp >= 0 && lp <= 100) monthMarkers.push({ label: mc.toLocaleDateString("en-US", { month: "short", year: "2-digit" }), leftPct: lp });
      mc.setMonth(mc.getMonth() + 1);
    }
    return (
      <div className="studio-preview-stack">
        {pager}
        <div className="timeline-shell">
          <div className="timeline-header-row">
            <div className="timeline-label-col" />
            <div className="timeline-track-col">
              {monthMarkers.map((mk, idx) => (
                <span key={idx} className="timeline-month-mark" style={{ left: `${mk.leftPct}%` }}>{mk.label}</span>
              ))}
            </div>
          </div>
          {parsedItems.map((item, idx) => (
            <div key={idx} className="timeline-item-row">
              <div className="timeline-label-col" title={item.title}>{item.title}</div>
              <div className="timeline-track-col">
                <div
                  className="timeline-bar"
                  style={{ left: `${toLeftPct(item.start.getTime())}%`, width: `${toWidthPct(item.start.getTime(), item.end.getTime())}%` }}
                  title={`${item.start.toLocaleDateString()} – ${item.end.toLocaleDateString()}`}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (report.view.mode === "calendar") {
    if (!reportShowsDetails(report)) {
      return <div className="empty-hint">Detail cards are turned off for this report.</div>;
    }
    const dateFieldId = report.view.calendarDateField;
    const titleFieldId = report.view.titleFieldId || report.selectedFieldIds[0];
    const eventsByDay = new Map<string, string[]>();
    result.rows.forEach((row) => {
      const raw = row[dateFieldId];
      if (raw == null) return;
      const d = new Date(String(raw));
      if (isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const title = formatStudioReportCell(row[titleFieldId], report, table, titleFieldId);
      eventsByDay.set(key, [...(eventsByDay.get(key) || []), title]);
    });
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const firstDow = new Date(calendarYear, calendarMonth, 1).getDay();
    const monthLabel = new Date(calendarYear, calendarMonth, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    function prevCalMonth() {
      if (calendarMonth === 0) { setCalendarYear((y) => y - 1); setCalendarMonth(11); }
      else setCalendarMonth((m) => m - 1);
    }
    function nextCalMonth() {
      if (calendarMonth === 11) { setCalendarYear((y) => y + 1); setCalendarMonth(0); }
      else setCalendarMonth((m) => m + 1);
    }
    return (
      <div className="studio-preview-stack">
        <div className="calendar-shell">
          <div className="calendar-nav">
            <button type="button" className="ghost-button" onClick={prevCalMonth}>‹ Prev</button>
            <strong className="calendar-month-label">{monthLabel}</strong>
            <button type="button" className="ghost-button" onClick={nextCalMonth}>Next ›</button>
          </div>
          <div className="calendar-grid">
            {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (
              <div key={d} className="calendar-day-header">{d}</div>
            ))}
            {cells.map((day, i) => {
              const evKey = day ? `${calendarYear}-${calendarMonth}-${day}` : null;
              const evs = evKey ? (eventsByDay.get(evKey) || []) : [];
              return (
                <div key={i} className={`calendar-day${day === null ? " empty-day" : ""}${evs.length ? " has-events" : ""}`}>
                  {day ? <span className="calendar-day-num">{day}</span> : null}
                  {evs.slice(0, 3).map((ev, j) => <div key={j} className="calendar-event-chip" title={ev}>{ev}</div>)}
                  {evs.length > 3 ? <div className="calendar-event-more">+{evs.length - 3} more</div> : null}
                </div>
              );
            })}
          </div>
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
