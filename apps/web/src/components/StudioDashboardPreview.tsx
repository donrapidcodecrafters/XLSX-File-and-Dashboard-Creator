import { useMemo, useState, type Dispatch, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";
import {
  clampDashboardWidgetWidth,
  clampDashboardWidgetHeight,
  getDashboardWidgetPlacements,
  getDashboardWidgetLayoutStyle,
  previewDashboardWidgetPlacements,
  previewDashboardWidgetPlacementsByDropPosition,
  previewDashboardWidgetPlacementsToRowEdge,
  previewDashboardWidgetPlacementsToTabEnd,
  formatReportCellValue,
  getReportFieldLabel,
  resolveDashboardWidgetDisplayMode,
  type DashboardWidgetPlacement,
  type DashboardWidgetDropPosition,
  type DashboardWidgetRowEdge,
  type DashboardWidgetMoveDirection,
  type DashboardDefinition,
  type DashboardRunResult,
  type ReportDefinition,
  type TableDefinition
} from "@studio/shared";
import { ChartPreview } from "./ChartPreview";
import { ResizableDataTable } from "./ResizableDataTable";
import { getChartAxisLabels, getChartViewportBounds } from "./studioReportUtils";

function getFieldLabel(report: ReportDefinition, table: TableDefinition | null, fieldId: string) {
  return table ? getReportFieldLabel(report, table, fieldId) : fieldId;
}

function formatCell(value: unknown, report: ReportDefinition, table: TableDefinition | null, fieldId: string) {
  return table ? formatReportCellValue(report, table, fieldId, value) : String(value ?? "");
}

function shouldShowWidgetChart(widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"], report: ReportDefinition) {
  return resolveDashboardWidgetDisplayMode(widget) === "chart"
    || (resolveDashboardWidgetDisplayMode(widget) === "table" && report.view.showChartInTable);
}

function resolveDropPosition(event: ReactDragEvent<HTMLElement>): DashboardWidgetDropPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  const xRatio = rect.width ? (event.clientX - rect.left) / rect.width : 0.5;
  const yRatio = rect.height ? (event.clientY - rect.top) / rect.height : 0.5;
  if (yRatio <= 0.3) return "before";
  if (yRatio >= 0.7) return "after";
  return xRatio < 0.5 ? "before" : "after";
}

type DashboardPreviewWidgetResult = DashboardRunResult["tabs"][number]["widgets"][number];

type DashboardPreviewDropTarget =
  | { type: "widget"; tabId: string; widgetId: string; position: DashboardWidgetDropPosition }
  | { type: "tab-end"; tabId: string }
  | { type: "row"; tabId: string; rowIndex: number; edge: DashboardWidgetRowEdge }
  | { type: "grid"; tabId: string; x: number; y: number; w: number; h: number };

function resolveGridDropTarget(
  event: ReactDragEvent<HTMLElement>,
  layout: { w: number; h: number }
) {
  const rect = event.currentTarget.getBoundingClientRect();
  const width = clampDashboardWidgetWidth(layout.w || 6);
  const height = clampDashboardWidgetHeight(layout.h || 4);
  const columnWidth = rect.width / 12 || 1;
  const clientX = Number.isFinite(event.clientX) ? event.clientX : rect.left + rect.width / 2;
  const clientY = Number.isFinite(event.clientY) ? event.clientY : rect.top + rect.height / 2;
  const pointerX = clientX - rect.left;
  const pointerY = clientY - rect.top;
  const x = Math.max(1, Math.min(13 - width, Math.round(pointerX / columnWidth - width / 2 + 1)));
  const y = Math.max(1, Math.round(pointerY / 96 - height / 2 + 1));
  return { x, y, w: width, h: height };
}

function resolvePreviewTargetFromPointer(
  event: ReactDragEvent<HTMLElement>,
  tabId: string,
  row: ReturnType<typeof buildRowsFromPlacements>[number],
  draggingWidgetId: string,
  draggingLayout: { w: number; h: number }
): DashboardPreviewDropTarget {
  const rect = event.currentTarget.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;
  const columnWidth = rect.width / 12 || 1;
  const rowHeight = 96;
  const rowHeightPx = Math.max(rowHeight, (row.endRow - row.startRow + 1) * rowHeight);
  const edgeThreshold = Math.min(40, rowHeightPx * 0.18);
  if (pointerY <= edgeThreshold) {
    return { type: "row", tabId, rowIndex: row.rowIndex, edge: "start" };
  }
  if (pointerY >= rowHeightPx - edgeThreshold) {
    return { type: "row", tabId, rowIndex: row.rowIndex, edge: "end" };
  }
  const matchingPlacement = Array.from(row.placementsById.values()).find((placement) => {
    if (placement.widgetId === draggingWidgetId) return false;
    const left = (placement.startCol - 1) * columnWidth;
    const right = placement.endCol * columnWidth;
    const top = (placement.startRow - row.startRow) * rowHeight;
    const bottom = (placement.endRow - row.startRow + 1) * rowHeight;
    return pointerX >= left && pointerX <= right && pointerY >= top && pointerY <= bottom;
  });
  if (matchingPlacement) {
    const placementLeft = (matchingPlacement.startCol - 1) * columnWidth;
    const placementRight = matchingPlacement.endCol * columnWidth;
    const placementMid = placementLeft + ((placementRight - placementLeft) / 2);
    return {
      type: "widget",
      tabId,
      widgetId: matchingPlacement.widgetId,
      position: pointerX < placementMid ? "before" : "after"
    };
  }
  return { type: "grid", tabId, ...resolveGridDropTarget(event, draggingLayout) };
}

function buildRowsFromPlacements(
  placements: DashboardWidgetPlacement[],
  widgetsById: Map<string, DashboardPreviewWidgetResult>
) {
  const rows = new Map<number, DashboardWidgetPlacement[]>();
  placements.forEach((placement) => {
    const current = rows.get(placement.startRow) || [];
    current.push(placement);
    rows.set(placement.startRow, current);
  });
  return Array.from(rows.values())
    .map((rowPlacements) => [...rowPlacements].sort((left, right) => left.startCol - right.startCol || left.index - right.index))
    .sort((left, right) => left[0].startRow - right[0].startRow)
    .map((rowPlacements, rowIndex) => ({
      rowIndex,
      startRow: rowPlacements[0].startRow,
      endRow: rowPlacements.reduce((max, placement) => Math.max(max, placement.endRow), rowPlacements[0].endRow),
      placementsById: new Map(rowPlacements.map((placement) => [placement.widgetId, placement])),
      remainingColumns: Math.max(0, 12 - rowPlacements.reduce((sum, placement) => sum + placement.width, 0)),
      widgetIds: rowPlacements.map((placement) => placement.widgetId),
      widgets: rowPlacements
        .map((placement) => widgetsById.get(placement.widgetId))
        .filter((widget): widget is DashboardPreviewWidgetResult => Boolean(widget))
    }))
    .filter((row) => row.widgets.length);
}

function formatCollisionAdjustment(requested: DashboardPreviewDropTarget | null, resolvedPlacement: DashboardWidgetPlacement | null) {
  if (!requested || requested.type !== "grid" || !resolvedPlacement) return "";
  const colShift = resolvedPlacement.startCol - requested.x;
  const rowShift = resolvedPlacement.startRow - requested.y;
  if (!colShift && !rowShift) return "";
  const parts = [
    rowShift ? `${rowShift > 0 ? "+" : ""}${rowShift} row${Math.abs(rowShift) === 1 ? "" : "s"}` : "",
    colShift ? `${colShift > 0 ? "+" : ""}${colShift} col${Math.abs(colShift) === 1 ? "" : "s"}` : ""
  ].filter(Boolean);
  return parts.join(" · ");
}

export function StudioDashboardPreview({
  dashboard,
  result,
  tables,
  runtimeValues,
  runtimeFilterOptionsById = {},
  setRuntimeValues,
  widgetSearch,
  activeTabId = "",
  selectedWidgetId,
  draggingWidget,
  onSelectWidget,
  onStartWidgetDrag,
  onEndWidgetDrag,
  onDropWidget,
  onDropWidgetToRow,
  onDropWidgetToTabEnd,
  onDropWidgetToGridPosition,
  onBeginResizeWidget,
  onMoveWidget: _onMoveWidget
}: {
  dashboard: DashboardDefinition;
  result: DashboardRunResult;
  tables: TableDefinition[];
  runtimeValues: Record<string, string>;
  runtimeFilterOptionsById?: Record<string, Array<{ value: string; label: string }>>;
  setRuntimeValues: Dispatch<SetStateAction<Record<string, string>>>;
  widgetSearch: string;
  activeTabId?: string;
  selectedWidgetId: string;
  draggingWidget: { tabId: string; widgetId: string } | null;
  onSelectWidget: (tabId: string, widgetId: string) => void;
  onStartWidgetDrag: (tabId: string, widgetId: string) => void;
  onEndWidgetDrag: () => void;
  onDropWidget: (tabId: string, widgetId: string, position: DashboardWidgetDropPosition) => void;
  onDropWidgetToRow: (tabId: string, rowIndex: number, edge: DashboardWidgetRowEdge) => void;
  onDropWidgetToTabEnd: (tabId: string) => void;
  onDropWidgetToGridPosition: (tabId: string, position: { x: number; y: number }) => void;
  onBeginResizeWidget: (event: ReactPointerEvent<HTMLButtonElement>, tabId: string, widgetId: string, layout: { w: number; h: number }) => void;
  onMoveWidget: (tabId: string, widgetId: string, direction: DashboardWidgetMoveDirection) => void;
}) {
  const normalizedQuery = widgetSearch.trim().toLowerCase();
  const [dropTarget, setDropTarget] = useState<DashboardPreviewDropTarget | null>(null);
  const [showAllRuntimeFilters, setShowAllRuntimeFilters] = useState(false);
  const basePlacementLookup = useMemo(() => {
    const next = new Map<string, Map<string, DashboardWidgetPlacement>>();
    result.tabs.forEach((tab) => {
      const dashboardTab = dashboard.tabs.find((candidate) => candidate.id === tab.id);
      if (!dashboardTab) return;
      next.set(tab.id, new Map(getDashboardWidgetPlacements(dashboardTab).map((placement) => [placement.widgetId, placement])));
    });
    return next;
  }, [dashboard.tabs, result.tabs]);
  const previewPlacementLookup = useMemo(() => {
    const next = new Map<string, Map<string, DashboardWidgetPlacement>>();
    result.tabs.forEach((tab) => {
      const dashboardTab = dashboard.tabs.find((candidate) => candidate.id === tab.id);
      if (!dashboardTab) return;
      const placements = dropTarget?.tabId === tab.id && draggingWidget?.tabId === tab.id
        ? (() => {
            if (dropTarget.type === "grid") {
              return previewDashboardWidgetPlacements(dashboardTab, draggingWidget.widgetId, { x: dropTarget.x, y: dropTarget.y });
            }
            if (dropTarget.type === "widget") {
              return previewDashboardWidgetPlacementsByDropPosition(
                dashboardTab,
                draggingWidget.widgetId,
                dropTarget.widgetId,
                dropTarget.position
              );
            }
            if (dropTarget.type === "row") {
              return previewDashboardWidgetPlacementsToRowEdge(
                dashboardTab,
                draggingWidget.widgetId,
                dropTarget.rowIndex,
                dropTarget.edge
              );
            }
            if (dropTarget.type === "tab-end") {
              return previewDashboardWidgetPlacementsToTabEnd(dashboardTab, draggingWidget.widgetId);
            }
            return getDashboardWidgetPlacements(dashboardTab);
          })()
        : getDashboardWidgetPlacements(dashboardTab);
      next.set(tab.id, new Map(placements.map((placement: DashboardWidgetPlacement) => [placement.widgetId, placement])));
    });
    return next;
  }, [dashboard.tabs, draggingWidget, dropTarget, result.tabs]);

  const visibleRuntimeFilters = useMemo(
    () => [...dashboard.runtimeFilters]
      .sort((left, right) => (left.displayOrder ?? 0) - (right.displayOrder ?? 0))
      .filter((filter) => !filter.targetTabIds?.length || !activeTabId || filter.targetTabIds.includes(activeTabId)),
    [activeTabId, dashboard.runtimeFilters]
  );
  const inlineRuntimeFilters = showAllRuntimeFilters ? visibleRuntimeFilters : visibleRuntimeFilters.slice(0, 4);
  const overflowRuntimeFilters = showAllRuntimeFilters ? [] : visibleRuntimeFilters.slice(4);
  const activeFilterChips = visibleRuntimeFilters
    .map((filter) => ({ id: filter.id, label: filter.label, value: runtimeValues[filter.id] || "" }))
    .filter((item) => String(item.value || "").trim());

  function updateRuntimeValue(filterId: string, value: string) {
    setRuntimeValues((current) => ({ ...current, [filterId]: value }));
  }

  return (
    <div className="studio-preview-stack">
      {visibleRuntimeFilters.length ? (
        <section className="card dashboard-runtime-filter-bar">
          <div className="card-head">
            <strong>Runtime filters</strong>
            <div className="studio-actions">
              <button type="button" className="ghost-button" onClick={() => setRuntimeValues({})}>Clear all</button>
              {overflowRuntimeFilters.length ? (
                <button type="button" className="ghost-button" onClick={() => setShowAllRuntimeFilters((current) => !current)}>
                  {showAllRuntimeFilters ? "Show fewer" : `More filters (${overflowRuntimeFilters.length})`}
                </button>
              ) : null}
            </div>
          </div>
          <div className="dashboard-runtime-filter-grid">
            {inlineRuntimeFilters.map((filter) => {
              const options = runtimeFilterOptionsById[filter.id] || [];
              const value = runtimeValues[filter.id] || "";
              return (
                <label className="field" key={filter.id}>
                  <span>{filter.label}</span>
                  {filter.uiType === "boolean-toggle" ? (
                    <select value={value} onChange={(event) => updateRuntimeValue(filter.id, event.target.value)}>
                      <option value="">Any</option>
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </select>
                  ) : options.length ? (
                    <select value={value} onChange={(event) => updateRuntimeValue(filter.id, event.target.value)}>
                      <option value="">All</option>
                      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  ) : (
                    <input value={value} onChange={(event) => updateRuntimeValue(filter.id, event.target.value)} />
                  )}
                </label>
              );
            })}
          </div>
          {activeFilterChips.length ? (
            <div className="dashboard-runtime-filter-chips">
              {activeFilterChips.map((chip) => (
                <button key={chip.id} type="button" className="dashboard-runtime-filter-chip" onClick={() => updateRuntimeValue(chip.id, "")}>
                  {chip.label}: {chip.value}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      {result.tabs.map((tab) => {
        const dashboardTab = dashboard.tabs.find((candidate) => candidate.id === tab.id) || null;
        const draggingLayout = draggingWidget && draggingWidget.tabId === tab.id
          ? dashboardTab?.widgets.find((widget) => widget.id === draggingWidget.widgetId)?.layout || { w: 6, h: 4 }
          : null;
        const widgets = tab.widgets.filter((widget) => {
          if (!normalizedQuery) return true;
          return `${widget.report.name} ${widget.message} ${widget.result.summary.map((item) => item.label).join(" ")}`.toLowerCase().includes(normalizedQuery);
        });
        const widgetsById = new Map(widgets.map((widget) => [widget.widgetId, widget]));
        const baseRows = dashboardTab
          ? (() => {
              const placements = Array.from((basePlacementLookup.get(tab.id) || new Map()).values())
                .filter((placement) => widgetsById.has(placement.widgetId));
              return buildRowsFromPlacements(placements, widgetsById);
            })()
          : [];
        const baseRowsByStartRow = new Map(baseRows.map((row) => [row.startRow, row]));
        const rows = dashboardTab
          ? (() => {
              const placementsById = previewPlacementLookup.get(tab.id)
                || new Map(getDashboardWidgetPlacements(dashboardTab).map((placement) => [placement.widgetId, placement]));
              const placements = Array.from(placementsById.values())
                .filter((placement) => widgetsById.has(placement.widgetId));
              return buildRowsFromPlacements(placements, widgetsById);
            })()
          : [];
        const displacedWidgetIds = new Set(
          draggingWidget?.tabId === tab.id
            ? Array.from((previewPlacementLookup.get(tab.id) || new Map()).values())
                .filter((placement) => {
                  if (placement.widgetId === draggingWidget.widgetId) return false;
                  const original = basePlacementLookup.get(tab.id)?.get(placement.widgetId);
                  return Boolean(
                    original
                    && (original.startCol !== placement.startCol
                      || original.startRow !== placement.startRow
                      || original.endCol !== placement.endCol
                      || original.endRow !== placement.endRow)
                  );
                })
                .map((placement) => placement.widgetId)
            : []
        );
        const previewDraggedPlacement = draggingWidget?.tabId === tab.id
          ? previewPlacementLookup.get(tab.id)?.get(draggingWidget.widgetId) || null
          : null;
        const collisionAdjustment = draggingWidget?.tabId === tab.id
          ? formatCollisionAdjustment(dropTarget?.tabId === tab.id ? dropTarget : null, previewDraggedPlacement)
          : "";
        return (
          <section className="card" key={tab.id}>
            <div className="card-head">
              <strong>{tab.name}</strong>
              <span className="micro">{widgets.length} cards</span>
            </div>
            {rows.length ? (
              <div className="dashboard-layout-stack">
                {rows.map((row) => {
                  const rowImpactCount = row.widgetIds.reduce((count, widgetId) => {
                    const original = basePlacementLookup.get(tab.id)?.get(widgetId);
                    const preview = row.placementsById.get(widgetId);
                    if (!original || !preview) return count;
                    const changed = original.startCol !== preview.startCol
                      || original.startRow !== preview.startRow
                      || original.endCol !== preview.endCol
                      || original.endRow !== preview.endRow;
                    return count + (changed ? 1 : 0);
                  }, 0);
                  const baseRow = baseRowsByStartRow.get(row.startRow) || null;
                  const rowChanged = Boolean(
                    rowImpactCount
                    || !baseRow
                    || baseRow.widgetIds.join("|") !== row.widgetIds.join("|")
                    || baseRow.remainingColumns !== row.remainingColumns
                    || baseRow.endRow !== row.endRow
                  );
                  const rowContainsDraggedWidget = Boolean(previewDraggedPlacement && row.widgetIds.includes(previewDraggedPlacement.widgetId));
                return (
                  <div
                    className={`dashboard-layout-row${rowChanged ? " is-preview-affected" : ""}${rowContainsDraggedWidget ? " is-preview-target" : ""}`}
                    key={`${tab.id}-row-${row.rowIndex}`}
                  >
                    {draggingLayout ? (
                      <div
                        className={`dashboard-row-dropzone${dropTarget?.type === "row" && dropTarget.tabId === tab.id && dropTarget.rowIndex === row.rowIndex && dropTarget.edge === "start" ? " active" : ""}`}
                        data-testid={`row-drop-${tab.id}-${row.rowIndex}-start`}
                        onDragOver={(event) => {
                          event.preventDefault();
                          setDropTarget({ type: "row", tabId: tab.id, rowIndex: row.rowIndex, edge: "start" });
                        }}
                        onDragLeave={() => {
                          if (dropTarget?.type === "row" && dropTarget.tabId === tab.id && dropTarget.rowIndex === row.rowIndex && dropTarget.edge === "start") {
                            setDropTarget(null);
                          }
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          onDropWidgetToRow(tab.id, row.rowIndex, "start");
                          setDropTarget(null);
                        }}
                      >
                        Drop above row {row.rowIndex + 1}
                      </div>
                    ) : null}
                    <div className="dashboard-layout-row-head">
                      <span className="micro">Row {row.rowIndex + 1}</span>
                      <span className="micro">{row.widgets.length} card{row.widgets.length === 1 ? "" : "s"} · {row.remainingColumns} open columns</span>
                      {rowContainsDraggedWidget ? (
                        <span className="badge" data-testid={`row-target-${tab.id}-${row.rowIndex}`}>Preview target</span>
                      ) : null}
                      {rowChanged ? (
                        <span className="badge" data-testid={`row-impact-${tab.id}-${row.rowIndex}`}>
                          {rowImpactCount || row.widgets.length} card{(rowImpactCount || row.widgets.length) === 1 ? "" : "s"} reflow
                        </span>
                      ) : null}
                      {rowContainsDraggedWidget && collisionAdjustment ? (
                        <span className="badge" data-testid={`row-adjustment-${tab.id}-${row.rowIndex}`}>Adjusted {collisionAdjustment}</span>
                      ) : null}
                    </div>
                    <div
                      className="widget-grid dashboard-layout-grid"
                      onDragOverCapture={(event) => {
                        if (!draggingLayout || !draggingWidget || draggingWidget.tabId !== tab.id) return;
                        event.preventDefault();
                        setDropTarget(resolvePreviewTargetFromPointer(event, tab.id, row, draggingWidget.widgetId, draggingLayout));
                      }}
                      onDrop={(event) => {
                        if (!draggingWidget || draggingWidget.tabId !== tab.id) return;
                        event.preventDefault();
                        const nextTarget = resolvePreviewTargetFromPointer(event, tab.id, row, draggingWidget.widgetId, draggingLayout || { w: 6, h: 4 });
                        if (nextTarget.type === "widget") {
                          onDropWidget(tab.id, nextTarget.widgetId, nextTarget.position);
                        } else if (nextTarget.type === "row") {
                          onDropWidgetToRow(tab.id, nextTarget.rowIndex, nextTarget.edge);
                        } else if (nextTarget.type === "grid") {
                          onDropWidgetToGridPosition(tab.id, { x: nextTarget.x, y: nextTarget.y });
                        }
                        setDropTarget(null);
                      }}
                    >
                      {dropTarget?.type === "grid"
                      && dropTarget.tabId === tab.id
                      && (
                        (previewDraggedPlacement && previewDraggedPlacement.startRow <= row.endRow && previewDraggedPlacement.endRow >= row.startRow)
                        || (previewDraggedPlacement && row.rowIndex === rows.length - 1 && previewDraggedPlacement.startRow > row.endRow)
                      ) ? (
                        <div
                          className={`dashboard-grid-drop-ghost${collisionAdjustment ? " is-adjusted" : ""}`}
                          data-testid={`grid-ghost-${tab.id}`}
                          aria-hidden="true"
                          style={{
                            gridColumn: `${(previewDraggedPlacement || { startCol: dropTarget.x, endCol: dropTarget.x + dropTarget.w - 1 }).startCol} / ${(previewDraggedPlacement || { startCol: dropTarget.x, endCol: dropTarget.x + dropTarget.w - 1 }).endCol + 1}`,
                            gridRow: `${(previewDraggedPlacement || { startRow: dropTarget.y, endRow: dropTarget.y + dropTarget.h - 1 }).startRow} / ${(previewDraggedPlacement || { startRow: dropTarget.y, endRow: dropTarget.y + dropTarget.h - 1 }).endRow + 1}`
                          }}
                        />
                      ) : null}
                      {row.widgets.map((widget) => {
                const widgetTable = tables.find((table) => table.id === widget.report.sourceTableId) || null;
                const isDragging = draggingWidget?.tabId === tab.id && draggingWidget?.widgetId === widget.widgetId;
                const isSelected = selectedWidgetId === widget.widgetId;
                const isDisplaced = displacedWidgetIds.has(widget.widgetId);
                const dropPosition = dropTarget?.type === "widget" && dropTarget.tabId === tab.id && dropTarget.widgetId === widget.widgetId ? dropTarget.position : null;
                const placement = row.placementsById.get(widget.widgetId) || null;
                const rowRelativePlacement = placement
                  ? {
                      ...placement,
                      startRow: placement.startRow - row.startRow + 1,
                      endRow: placement.endRow - row.startRow + 1
                    }
                  : null;
                return (
                  <article
                    className={`widget-card dashboard-layout-item${isDragging ? " is-dragging" : ""}${isSelected ? " is-selected" : ""}${isDisplaced ? " is-displaced" : ""}${dropPosition === "before" ? " is-drop-before" : ""}${dropPosition === "after" ? " is-drop-after" : ""}`}
                    key={widget.widgetId}
                    style={getDashboardWidgetLayoutStyle(widget.widget, rowRelativePlacement)}
                    role="button"
                    tabIndex={0}
                    draggable
                    onClick={() => onSelectWidget(tab.id, widget.widgetId)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectWidget(tab.id, widget.widgetId);
                      }
                    }}
                    onDragStart={() => onStartWidgetDrag(tab.id, widget.widgetId)}
                    onDragEnd={() => {
                      setDropTarget(null);
                      onEndWidgetDrag();
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDropTarget({ type: "widget", tabId: tab.id, widgetId: widget.widgetId, position: resolveDropPosition(event) });
                    }}
                    onDragLeave={() => {
                      if (dropTarget?.type === "widget" && dropTarget.tabId === tab.id && dropTarget.widgetId === widget.widgetId) {
                        setDropTarget(null);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const position = resolveDropPosition(event);
                      onDropWidget(tab.id, widget.widgetId, position);
                      setDropTarget(null);
                    }}
                  >
                    <div className="widget-head">
                      <div className="widget-head-copy">
                        {!widget.widget.hideTitle ? <strong>{widget.widget.title || widget.report.name}</strong> : <strong className="micro">Title hidden</strong>}
                        <span className="micro">Click card to edit widget settings</span>
                      </div>
                      {selectedWidgetId === widget.widgetId ? <span className="badge">Selected</span> : null}
                    </div>
                    <div className={`widget-state-banner ${widget.status === "failed" ? "widget-state-banner-failed" : "widget-state-banner-ready"}`}>
                      <strong>{widget.status === "failed" ? "Card unavailable" : "Preview ready"}</strong>
                      <span>{widget.error || widget.message}</span>
                    </div>
                    {widget.status === "complete" && widget.widget.showSummary ? (
                      <div className="widget-metrics">
                        {widget.result.summary.map((item) => (
                          <div className="mini-stat" key={item.label}>
                            <strong>{item.value}</strong>
                            <span>{item.label}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {widget.status === "complete" && shouldShowWidgetChart(widget.widget, widget.report) ? (
                      <div className="mini-chart">
                        {(() => {
                          const axisLabels = getChartAxisLabels(widget.report, widgetTable);
                          const requestedChartHeight = Math.max(
                            220,
                            ((widget.widget.layout.h || 4) * 96 - 96)
                          );
                          const chartBounds = getChartViewportBounds(widget.report.view.chartType, widget.result.chartData.length, true, requestedChartHeight);
                          return (
                            <div className="chart-scroll-shell">
                              <div style={{ minWidth: `${chartBounds.minWidth}px`, minHeight: `${chartBounds.minHeight}px`, width: "100%", height: "100%" }}>
                                <ChartPreview
                                  chartType={widget.report.view.chartType}
                                  data={widget.result.chartData}
                                  title={widget.report.view.chartTitle || widget.widget.title}
                                  decimalPlaces={widget.report.view.decimalPlaces}
                                  chartColors={widget.report.view.chartColors}
                                  chartValueColors={widget.report.view.chartValueColors}
                                  chartSort={widget.report.view.chartSort}
                                  chartOrientation={widget.report.view.chartOrientation}
                                  xAxisLabel={axisLabels.xAxisLabel}
                                  yAxisLabel={axisLabels.yAxisLabel}
                                  secondaryYAxisLabel={axisLabels.secondaryYAxisLabel}
                                  secondarySeriesType={widget.report.view.chartSecondarySeriesType}
                                  compact
                                  showLegend={widget.report.view.chartShowLegend}
                                  showValues={widget.report.view.chartShowValues}
                                  viewportHeight={chartBounds.minHeight}
                                />
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    ) : null}
                    {widget.status === "complete" && (resolveDashboardWidgetDisplayMode(widget.widget) === "table" || widget.widget.showDetails) ? (
                      <div className="compact-table-shell">
                        <ResizableDataTable
                          className="preview-widget-table-shell"
                          columns={widget.report.selectedFieldIds.slice(0, 6).map((fieldId) => ({
                            key: fieldId,
                            label: getFieldLabel(widget.report, widgetTable, fieldId)
                          }))}
                          rows={widget.result.rows.slice(0, 8).map((row, index) => ({
                            key: String(row.__recordId || index),
                            cells: widget.report.selectedFieldIds.slice(0, 6).map((fieldId) => formatCell(row[fieldId], widget.report, widgetTable, fieldId))
                          }))}
                        />
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="widget-resize-handle"
                      aria-label="Resize card"
                      title="Drag to resize"
                      onPointerDown={(event) => onBeginResizeWidget(event, tab.id, widget.widgetId, widget.widget.layout)}
                    />
                  </article>
                );
                      })}
                    </div>
                    {draggingLayout ? (
                      <div
                        className={`dashboard-grid-dropzone${dropTarget?.type === "grid" && dropTarget.tabId === tab.id ? " active" : ""}`}
                        data-testid={`grid-drop-${tab.id}`}
                        onDragOver={(event) => {
                          event.preventDefault();
                          setDropTarget({ type: "grid", tabId: tab.id, ...resolveGridDropTarget(event, draggingLayout) });
                        }}
                        onDragLeave={() => {
                          if (dropTarget?.type === "grid" && dropTarget.tabId === tab.id) {
                            setDropTarget(null);
                          }
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const nextTarget = dropTarget?.type === "grid" && dropTarget.tabId === tab.id
                            ? dropTarget
                            : { type: "grid" as const, tabId: tab.id, ...resolveGridDropTarget(event, draggingLayout) };
                          onDropWidgetToGridPosition(tab.id, { x: nextTarget.x, y: nextTarget.y });
                          setDropTarget(null);
                        }}
                      >
                        Snap card anywhere on the grid
                      </div>
                    ) : null}
                    {draggingLayout ? (
                      <div
                        className={`dashboard-row-dropzone${dropTarget?.type === "row" && dropTarget.tabId === tab.id && dropTarget.rowIndex === row.rowIndex && dropTarget.edge === "end" ? " active" : ""}`}
                        data-testid={`row-drop-${tab.id}-${row.rowIndex}-end`}
                        onDragOver={(event) => {
                          event.preventDefault();
                          setDropTarget({ type: "row", tabId: tab.id, rowIndex: row.rowIndex, edge: "end" });
                        }}
                        onDragLeave={() => {
                          if (dropTarget?.type === "row" && dropTarget.tabId === tab.id && dropTarget.rowIndex === row.rowIndex && dropTarget.edge === "end") {
                            setDropTarget(null);
                          }
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          onDropWidgetToRow(tab.id, row.rowIndex, "end");
                          setDropTarget(null);
                        }}
                      >
                        Drop below row {row.rowIndex + 1}
                      </div>
                    ) : null}
                  </div>
                );})}
              </div>
            ) : widgets.length || dashboardTab?.widgets.length ? (
              <div className="empty-hint">No cards match this search.</div>
            ) : (
              <div
                className={`widget-grid dashboard-layout-grid${dropTarget?.type === "tab-end" && dropTarget.tabId === tab.id ? " has-drop-end" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (draggingLayout) {
                    setDropTarget({ type: "grid", tabId: tab.id, ...resolveGridDropTarget(event, draggingLayout) });
                    return;
                  }
                  if (event.target !== event.currentTarget) return;
                  setDropTarget({ type: "tab-end", tabId: tab.id });
                }}
                onDragLeave={(event) => {
                  if (event.target === event.currentTarget && (dropTarget?.type === "tab-end" || dropTarget?.type === "grid") && dropTarget.tabId === tab.id) {
                    setDropTarget(null);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggingLayout) {
                    const nextTarget = dropTarget?.type === "grid" && dropTarget.tabId === tab.id
                      ? dropTarget
                      : { type: "grid" as const, tabId: tab.id, ...resolveGridDropTarget(event, draggingLayout) };
                    onDropWidgetToGridPosition(tab.id, { x: nextTarget.x, y: nextTarget.y });
                    setDropTarget(null);
                    return;
                  }
                  if (event.target !== event.currentTarget) return;
                  onDropWidgetToTabEnd(tab.id);
                  setDropTarget(null);
                }}
              >
                {dropTarget?.type === "grid" && dropTarget.tabId === tab.id ? (
                  <div
                    className="dashboard-grid-drop-ghost"
                    data-testid={`grid-ghost-${tab.id}`}
                    aria-hidden="true"
                    style={{
                      gridColumn: `${dropTarget.x} / ${dropTarget.x + dropTarget.w}`,
                      gridRow: `${dropTarget.y} / ${dropTarget.y + dropTarget.h}`
                    }}
                  />
                ) : null}
                <div className="dashboard-empty-dropzone">
                  {draggingLayout ? "Drop the widget anywhere on this tab to place it on the grid." : "This tab has no widgets yet."}
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
