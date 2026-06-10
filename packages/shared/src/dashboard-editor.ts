import type { DashboardDefinition, DashboardTabDefinition, WidgetDefinition } from "./models.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const DASHBOARD_LAYOUT_COLUMNS = 12;
export type DashboardWidgetMoveDirection = "left" | "right" | "up" | "down";
export type DashboardWidgetDropPosition = "before" | "after";
export type DashboardWidgetRowEdge = "start" | "end";
export type DashboardRowLayoutPreset = "equal" | "wide-left" | "wide-right";

export interface DashboardWidgetPlacement {
  widgetId: string;
  index: number;
  startCol: number;
  endCol: number;
  startRow: number;
  endRow: number;
  width: number;
  height: number;
}

export interface DashboardWidgetRowPlacement {
  rowIndex: number;
  startRow: number;
  endRow: number;
  startIndex: number;
  endIndex: number;
  filledColumns: number;
  remainingColumns: number;
  maxHeight: number;
  placements: DashboardWidgetPlacement[];
  widgetIds: string[];
}

interface DashboardRowWidget {
  widget: WidgetDefinition;
  placement: DashboardWidgetPlacement;
}

function maxWidgetStartCol(width: number) {
  return Math.max(1, DASHBOARD_LAYOUT_COLUMNS - width + 1);
}

export function clampDashboardWidgetWidth(value: number) {
  return Math.max(1, Math.min(12, Math.round(value || 1)));
}

export function clampDashboardWidgetHeight(value: number) {
  return Math.max(2, Math.min(10, Math.round(value || 2)));
}

export function clampDashboardWidgetX(value: number, width = 1) {
  return Math.max(1, Math.min(maxWidgetStartCol(clampDashboardWidgetWidth(width)), Math.round(value || 1)));
}

export function clampDashboardWidgetY(value: number) {
  return Math.max(1, Math.min(200, Math.round(value || 1)));
}

export function resolveDashboardWidgetDisplayMode(widget: WidgetDefinition) {
  if (widget.displayMode !== "inherit") return widget.displayMode;
  if (widget.showDetails) return "table" as const;
  if (widget.showSummary) return "summary" as const;
  return "chart" as const;
}

export function getDashboardWidgetLayoutBounds(widget: WidgetDefinition) {
  const displayMode = resolveDashboardWidgetDisplayMode(widget);
  if (displayMode === "summary") {
    return { minW: 2, maxW: 12, minH: 2, maxH: 6, defaultW: 4, defaultH: 3 };
  }
  if (displayMode === "chart") {
    return { minW: 4, maxW: 12, minH: 4, maxH: 10, defaultW: 6, defaultH: 4 };
  }
  return {
    minW: 4,
    maxW: 12,
    minH: widget.showDetails ? 4 : 3,
    maxH: 10,
    defaultW: 6,
    defaultH: widget.showDetails ? 4 : 3
  };
}

export function normalizeDashboardWidgetLayout(
  widget: WidgetDefinition,
  layout: { w: number; h: number; x?: number; y?: number } = widget.layout
) {
  const bounds = getDashboardWidgetLayoutBounds(widget);
  const width = Math.max(bounds.minW, Math.min(bounds.maxW, clampDashboardWidgetWidth(layout.w || bounds.defaultW)));
  const height = Math.max(bounds.minH, Math.min(bounds.maxH, clampDashboardWidgetHeight(layout.h || bounds.defaultH)));
  return {
    w: width,
    h: height,
    ...(Number.isFinite(Number(layout.x))
      ? { x: clampDashboardWidgetX(Number(layout.x), width) }
      : {}),
    ...(Number.isFinite(Number(layout.y))
      ? { y: clampDashboardWidgetY(Number(layout.y)) }
      : {})
  };
}

export function getDashboardWidgetLayoutStyle(widget: WidgetDefinition, placement?: DashboardWidgetPlacement | null) {
  const layout = normalizeDashboardWidgetLayout(widget);
  return {
    gridColumn: placement ? `${placement.startCol} / ${placement.endCol + 1}` : `span ${layout.w}`,
    ...(placement ? { gridRow: `${placement.startRow} / ${placement.endRow + 1}` } : {}),
    minHeight: `${layout.h * 96}px`
  };
}

export function resolveActiveDashboardTabId(dashboard: DashboardDefinition | null | undefined, activeTabId = "") {
  if (!dashboard?.tabs.length) return "";
  if (dashboard.tabs.some((tab) => tab.id === activeTabId)) return activeTabId;
  if (dashboard.defaultTabId && dashboard.tabs.some((tab) => tab.id === dashboard.defaultTabId)) {
    return dashboard.defaultTabId;
  }
  return dashboard.tabs[0].id;
}

export function resolveSelectedDashboardWidgetId(tab: DashboardTabDefinition | null | undefined, selectedWidgetId = "") {
  if (!tab?.widgets.length) return "";
  return tab.widgets.some((widget) => widget.id === selectedWidgetId) ? selectedWidgetId : "";
}

function clampIndex(value: number, max: number) {
  return Math.max(0, Math.min(max, value));
}

function rangeOverlap(startA: number, endA: number, startB: number, endB: number) {
  return Math.max(startA, startB) <= Math.min(endA, endB);
}

function placementCenterX(placement: DashboardWidgetPlacement) {
  return placement.startCol + (placement.width - 1) / 2;
}

function placementCenterY(placement: DashboardWidgetPlacement) {
  return placement.startRow + (placement.height - 1) / 2;
}

function sortByScore<T>(items: T[], scorer: (item: T) => [number, number, number]) {
  return [...items].sort((left, right) => {
    const leftScore = scorer(left);
    const rightScore = scorer(right);
    return leftScore[0] - rightScore[0] || leftScore[1] - rightScore[1] || leftScore[2] - rightScore[2];
  });
}

function moveWidgetAtIndex(widgets: WidgetDefinition[], widgetId: string, targetIndex: number) {
  const nextWidgets = [...widgets];
  const sourceIndex = nextWidgets.findIndex((widget) => widget.id === widgetId);
  if (sourceIndex < 0) return widgets;
  const [widget] = nextWidgets.splice(sourceIndex, 1);
  const insertionIndex = clampIndex(targetIndex > sourceIndex ? targetIndex - 1 : targetIndex, nextWidgets.length);
  nextWidgets.splice(insertionIndex, 0, widget);
  return nextWidgets;
}

function sortWidgetsByGridPreference(widgets: WidgetDefinition[], prioritizedWidgetId = "") {
  return [...widgets]
    .map((widget, index) => ({ widget, index, layout: normalizeDashboardWidgetLayout(widget) }))
    .sort((left, right) => {
      const leftPriority = left.widget.id === prioritizedWidgetId ? 0 : 1;
      const rightPriority = right.widget.id === prioritizedWidgetId ? 0 : 1;
      return left.layout.y! - right.layout.y!
        || left.layout.x! - right.layout.x!
        || leftPriority - rightPriority
        || left.index - right.index;
    })
    .map((item) => item.widget);
}

function placementsOverlap(
  a: Pick<DashboardWidgetPlacement, "startCol" | "endCol" | "startRow" | "endRow">,
  b: Pick<DashboardWidgetPlacement, "startCol" | "endCol" | "startRow" | "endRow">
) {
  return rangeOverlap(a.startCol, a.endCol, b.startCol, b.endCol)
    && rangeOverlap(a.startRow, a.endRow, b.startRow, b.endRow);
}

function canPlaceWidget(placements: DashboardWidgetPlacement[], candidate: DashboardWidgetPlacement) {
  return !placements.some((placement) => placementsOverlap(placement, candidate));
}

function syncWidgetsToPlacements(
  widgets: WidgetDefinition[],
  placements: DashboardWidgetPlacement[]
) {
  return widgets.map((widget, index) => {
    const placement = placements[index];
    if (!placement) return widget;
    return {
      ...widget,
      layout: normalizeDashboardWidgetLayout(widget, {
        ...widget.layout,
        w: placement.width,
        h: placement.height,
        x: placement.startCol,
        y: placement.startRow
      })
    };
  });
}

function findNextWidgetPlacement(
  widget: WidgetDefinition,
  index: number,
  placements: DashboardWidgetPlacement[]
) {
  const layout = normalizeDashboardWidgetLayout(widget);
  const preferredX = clampDashboardWidgetX(layout.x ?? 1, layout.w);
  const preferredY = clampDashboardWidgetY(layout.y ?? 1);
  const maxStartCol = maxWidgetStartCol(layout.w);

  for (let row = preferredY; row <= preferredY + 120; row += 1) {
    const columns: number[] = row === preferredY
      ? [preferredX, ...Array.from({ length: maxStartCol }, (_, colIndex) => colIndex + 1).filter((column) => column !== preferredX)]
      : Array.from({ length: maxStartCol }, (_, colIndex) => colIndex + 1);
    for (const startCol of columns) {
      const candidate: DashboardWidgetPlacement = {
        widgetId: widget.id,
        index,
        startCol,
        endCol: startCol + layout.w - 1,
        startRow: row,
        endRow: row + layout.h - 1,
        width: layout.w,
        height: layout.h
      };
      if (canPlaceWidget(placements, candidate)) {
        return candidate;
      }
    }
  }

  const fallbackRow = placements.reduce((max, placement) => Math.max(max, placement.endRow), 0) + 1;
  return {
    widgetId: widget.id,
    index,
    startCol: 1,
    endCol: layout.w,
    startRow: fallbackRow,
    endRow: fallbackRow + layout.h - 1,
    width: layout.w,
    height: layout.h
  };
}

function applyWidthsToWidgets(rowWidgets: WidgetDefinition[], widths: number[]) {
  return rowWidgets.map((widget, index) => ({
    ...widget,
    layout: normalizeDashboardWidgetLayout(widget, {
      ...widget.layout,
      w: widths[index] ?? normalizeDashboardWidgetLayout(widget).w
    })
  }));
}

function updateDashboardRowWidgets(
  tab: DashboardTabDefinition,
  rowIndex: number,
  updater: (rowWidgets: WidgetDefinition[]) => WidgetDefinition[]
) {
  const rows = getDashboardWidgetRows(tab);
  const targetRow = rows[rowIndex];
  if (!targetRow) return tab;
  const before = tab.widgets.slice(0, targetRow.startIndex);
  const currentRowWidgets = tab.widgets.slice(targetRow.startIndex, targetRow.endIndex + 1);
  const after = tab.widgets.slice(targetRow.endIndex + 1);
  return {
    ...tab,
    widgets: [...before, ...updater(currentRowWidgets.map((widget) => clone(widget))), ...after]
  };
}

function supportedRowPresetWidths(rowWidgets: WidgetDefinition[], preset: DashboardRowLayoutPreset) {
  if (!rowWidgets.length) return null;
  if (rowWidgets.length === 1) return [12];
  if (rowWidgets.length === 2) {
    if (preset === "equal") return [6, 6];
    if (preset === "wide-left") return [8, 4];
    return [4, 8];
  }
  if (rowWidgets.length === 3) {
    if (preset === "equal") return [4, 4, 4];
    if (preset === "wide-left") return [6, 3, 3];
    return [3, 3, 6];
  }
  return null;
}

function findDirectionalPlacement(tab: DashboardTabDefinition, widgetId: string, direction: DashboardWidgetMoveDirection) {
  const placements = getDashboardWidgetPlacements(tab);
  const current = placements.find((placement) => placement.widgetId === widgetId);
  if (!current) return null;
  const others = placements.filter((placement) => placement.widgetId !== widgetId);
  if (!others.length) return null;

  if (direction === "left") {
    const rowMatches = others.filter((placement) =>
      placement.endCol < current.startCol
      && rangeOverlap(placement.startRow, placement.endRow, current.startRow, current.endRow)
    );
    const candidates = rowMatches.length ? rowMatches : others.filter((placement) => placement.endCol < current.startCol);
    return sortByScore(candidates, (placement) => [
      Math.abs(placementCenterY(current) - placementCenterY(placement)),
      current.startCol - placement.endCol,
      Math.abs(current.index - placement.index)
    ])[0] || null;
  }

  if (direction === "right") {
    const rowMatches = others.filter((placement) =>
      placement.startCol > current.endCol
      && rangeOverlap(placement.startRow, placement.endRow, current.startRow, current.endRow)
    );
    const candidates = rowMatches.length ? rowMatches : others.filter((placement) => placement.startCol > current.endCol);
    return sortByScore(candidates, (placement) => [
      Math.abs(placementCenterY(current) - placementCenterY(placement)),
      placement.startCol - current.endCol,
      Math.abs(current.index - placement.index)
    ])[0] || null;
  }

  if (direction === "up") {
    const columnMatches = others.filter((placement) =>
      placement.endRow < current.startRow
      && rangeOverlap(placement.startCol, placement.endCol, current.startCol, current.endCol)
    );
    const candidates = columnMatches.length ? columnMatches : others.filter((placement) => placement.endRow < current.startRow);
    return sortByScore(candidates, (placement) => [
      current.startRow - placement.endRow,
      Math.abs(placementCenterX(current) - placementCenterX(placement)),
      Math.abs(current.index - placement.index)
    ])[0] || null;
  }

  const columnMatches = others.filter((placement) =>
    placement.startRow > current.endRow
    && rangeOverlap(placement.startCol, placement.endCol, current.startCol, current.endCol)
  );
  const candidates = columnMatches.length ? columnMatches : others.filter((placement) => placement.startRow > current.endRow);
  return sortByScore(candidates, (placement) => [
    placement.startRow - current.endRow,
    Math.abs(placementCenterX(current) - placementCenterX(placement)),
    Math.abs(current.index - placement.index)
  ])[0] || null;
}

function updateDashboardTab(
  dashboard: DashboardDefinition,
  tabId: string,
  updater: (tab: DashboardTabDefinition) => DashboardTabDefinition
) {
  const nextDashboard = clone(dashboard);
  nextDashboard.tabs = nextDashboard.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab));
  return nextDashboard;
}

export function getDashboardWidgetPlacements(tab: DashboardTabDefinition | null | undefined): DashboardWidgetPlacement[] {
  if (!tab?.widgets.length) return [];
  const placements: DashboardWidgetPlacement[] = [];
  tab.widgets.forEach((widget, index) => {
    placements.push(findNextWidgetPlacement(widget, index, placements));
  });
  return placements;
}

function previewDashboardPlacementsFromWidgets(
  tab: DashboardTabDefinition | null | undefined,
  widgets: WidgetDefinition[]
) {
  if (!tab?.widgets.length) return [];
  return getDashboardWidgetPlacements(compactDashboardTabWidgets({ ...tab, widgets }) || { ...tab, widgets });
}

export function previewDashboardWidgetPlacements(
  tab: DashboardTabDefinition | null | undefined,
  widgetId: string,
  position: { x: number; y: number } | null | undefined
) {
  if (!tab?.widgets.length || !widgetId || !position) return getDashboardWidgetPlacements(tab);
  const widgets = sortWidgetsByGridPreference(
    tab.widgets.map((widget) => widget.id === widgetId
      ? {
          ...widget,
          layout: normalizeDashboardWidgetLayout(widget, {
            ...widget.layout,
            x: position.x,
            y: position.y
          })
        }
      : widget),
    widgetId
  );
  return previewDashboardPlacementsFromWidgets(tab, widgets);
}

export function previewDashboardWidgetPlacementsByDropPosition(
  tab: DashboardTabDefinition | null | undefined,
  sourceWidgetId: string,
  targetWidgetId: string,
  position: DashboardWidgetDropPosition = "before"
) {
  if (!tab?.widgets.length || !sourceWidgetId || !targetWidgetId || sourceWidgetId === targetWidgetId) {
    return getDashboardWidgetPlacements(tab);
  }
  const targetIndex = tab.widgets.findIndex((widget) => widget.id === targetWidgetId);
  if (targetIndex < 0) return getDashboardWidgetPlacements(tab);
  return previewDashboardPlacementsFromWidgets(
    tab,
    moveWidgetAtIndex(tab.widgets, sourceWidgetId, targetIndex + (position === "after" ? 1 : 0))
  );
}

export function previewDashboardWidgetPlacementsToRowEdge(
  tab: DashboardTabDefinition | null | undefined,
  widgetId: string,
  targetRowIndex: number,
  edge: DashboardWidgetRowEdge = "start"
) {
  if (!tab?.widgets.length || !widgetId) return getDashboardWidgetPlacements(tab);
  const rows = getDashboardWidgetRows(tab);
  const targetRow = rows[targetRowIndex];
  if (!targetRow) return getDashboardWidgetPlacements(tab);
  const targetIndex = edge === "start" ? targetRow.startIndex : targetRow.endIndex + 1;
  return previewDashboardPlacementsFromWidgets(tab, moveWidgetAtIndex(tab.widgets, widgetId, targetIndex));
}

export function previewDashboardWidgetPlacementsToTabEnd(
  tab: DashboardTabDefinition | null | undefined,
  widgetId: string
) {
  if (!tab?.widgets.length || !widgetId) return getDashboardWidgetPlacements(tab);
  return previewDashboardPlacementsFromWidgets(tab, moveWidgetAtIndex(tab.widgets, widgetId, tab.widgets.length));
}

export function getDashboardWidgetRows(tab: DashboardTabDefinition | null | undefined): DashboardWidgetRowPlacement[] {
  const placements = getDashboardWidgetPlacements(tab);
  if (!placements.length) return [];
  const rows = new Map<number, DashboardWidgetPlacement[]>();
  placements.forEach((placement) => {
    const current = rows.get(placement.startRow) || [];
    current.push(placement);
    rows.set(placement.startRow, current);
  });
  return Array.from(rows.values())
    .map((rowPlacements) => [...rowPlacements].sort((left, right) => left.startCol - right.startCol || left.index - right.index))
    .sort((left, right) => left[0].startRow - right[0].startRow)
    .map((rowPlacements, rowIndex) => {
      const startRow = rowPlacements[0].startRow;
      const endRow = rowPlacements.reduce((max, placement) => Math.max(max, placement.endRow), startRow);
      const filledColumns = rowPlacements.reduce((sum, placement) => sum + placement.width, 0);
      const maxHeight = rowPlacements.reduce((max, placement) => Math.max(max, placement.height), 0);
      return {
        rowIndex,
        startRow,
        endRow,
        startIndex: rowPlacements[0].index,
        endIndex: rowPlacements[rowPlacements.length - 1].index,
        filledColumns,
        remainingColumns: Math.max(0, DASHBOARD_LAYOUT_COLUMNS - filledColumns),
        maxHeight,
        placements: rowPlacements,
        widgetIds: rowPlacements.map((placement) => placement.widgetId)
      };
    });
}

function distributeRowWidth(rowWidgets: DashboardRowWidget[]) {
  if (!rowWidgets.length) return rowWidgets.map(({ widget }) => widget);
  const nextWidgets = rowWidgets.map(({ widget }) => ({
    ...widget,
    layout: normalizeDashboardWidgetLayout(widget)
  }));
  let leftover = DASHBOARD_LAYOUT_COLUMNS - nextWidgets.reduce((sum, widget) => sum + normalizeDashboardWidgetLayout(widget).w, 0);
  if (leftover <= 0) return nextWidgets;

  if (nextWidgets.length === 1) {
    const widget = nextWidgets[0];
    const bounds = getDashboardWidgetLayoutBounds(widget);
    widget.layout = normalizeDashboardWidgetLayout(widget, {
      ...widget.layout,
      w: Math.min(bounds.maxW, widget.layout.w + leftover)
    });
    return nextWidgets;
  }

  const summaryOnly = nextWidgets.every((widget) => resolveDashboardWidgetDisplayMode(widget) === "summary");
  while (leftover > 0) {
    const growable = nextWidgets
      .map((widget, index) => {
        const layout = normalizeDashboardWidgetLayout(widget);
        const bounds = getDashboardWidgetLayoutBounds(widget);
        return {
          index,
          widget,
          layout,
          capacity: bounds.maxW - layout.w
        };
      })
      .filter((item) => item.capacity > 0)
      .sort((left, right) => {
        if (summaryOnly) {
          return left.layout.w - right.layout.w || right.capacity - left.capacity || left.index - right.index;
        }
        return right.capacity - left.capacity || left.layout.w - right.layout.w || left.index - right.index;
      });
    if (!growable.length) break;
    const target = growable[0];
    const widget = nextWidgets[target.index];
    widget.layout = normalizeDashboardWidgetLayout(widget, {
      ...widget.layout,
      w: target.layout.w + 1
    });
    leftover -= 1;
  }

  return nextWidgets;
}

export function balanceDashboardTabWidgets(tab: DashboardTabDefinition | null | undefined) {
  if (!tab?.widgets.length) return tab || null;
  const placements = getDashboardWidgetPlacements(tab);
  const rows = new Map<number, DashboardRowWidget[]>();
  placements.forEach((placement) => {
    const widget = tab.widgets[placement.index];
    if (!widget) return;
    const current = rows.get(placement.startRow) || [];
    current.push({ widget, placement });
    rows.set(placement.startRow, current);
  });
  const widgets = Array.from(rows.values())
    .sort((left, right) => left[0].placement.startRow - right[0].placement.startRow)
    .flatMap((row) => distributeRowWidth(row));
  const nextPlacements = getDashboardWidgetPlacements({ ...tab, widgets });
  return {
    ...tab,
    widgets: syncWidgetsToPlacements(widgets, nextPlacements)
  };
}

export function compactDashboardTabWidgets(tab: DashboardTabDefinition | null | undefined) {
  if (!tab?.widgets.length) return tab || null;
  const placements = getDashboardWidgetPlacements(tab);
  return {
    ...tab,
    widgets: syncWidgetsToPlacements(tab.widgets, placements)
  };
}

// Re-packs widget y values from scratch, sorting by stored (y,x) and assigning
// compact sequential rows starting at 1. Fixes corrupted large y values without
// altering the visual row groupings or changing stored data.
export function repackDashboardTabLayout(tab: DashboardTabDefinition | null | undefined): DashboardTabDefinition | null {
  if (!tab?.widgets.length) return tab || null;

  const withLayout = tab.widgets.map((widget) => ({
    widget,
    layout: normalizeDashboardWidgetLayout(widget)
  }));

  // Sort by stored y then x to recover visual order
  withLayout.sort((a, b) => {
    const ay = a.layout.y ?? 1;
    const by = b.layout.y ?? 1;
    if (ay !== by) return ay - by;
    return (a.layout.x ?? 1) - (b.layout.x ?? 1);
  });

  // Group into rows: consecutive widgets sharing the same original y are one row
  type Row = typeof withLayout;
  const rows: Row[] = [];
  let lastY = -1;
  for (const item of withLayout) {
    const y = item.layout.y ?? 1;
    if (y !== lastY) { rows.push([]); lastY = y; }
    rows[rows.length - 1].push(item);
  }

  // Assign compact y values to each row group
  let nextY = 1;
  const repacked = new Map<string, number>();
  for (const row of rows) {
    for (const { widget } of row) repacked.set(widget.id, nextY);
    nextY += Math.max(...row.map(({ layout }) => layout.h));
  }

  return {
    ...tab,
    widgets: tab.widgets.map((widget) => ({
      ...widget,
      layout: { ...widget.layout, y: repacked.get(widget.id) ?? widget.layout.y }
    }))
  };
}

export function balanceDashboardTabLayout(
  dashboard: DashboardDefinition,
  tabId: string
) {
  return updateDashboardTab(dashboard, tabId, (tab) => balanceDashboardTabWidgets(tab) || tab);
}

export function balanceDashboardLayout(dashboard: DashboardDefinition) {
  const nextDashboard = clone(dashboard);
  nextDashboard.tabs = nextDashboard.tabs.map((tab) => balanceDashboardTabWidgets(tab) || tab);
  return nextDashboard;
}

export function balanceDashboardRow(
  dashboard: DashboardDefinition,
  tabId: string,
  rowIndex: number
) {
  return updateDashboardTab(dashboard, tabId, (tab) => {
    const nextTab = updateDashboardRowWidgets(tab, rowIndex, (rowWidgets) => {
      const rowPlacements = getDashboardWidgetPlacements({ ...tab, widgets: rowWidgets });
      const normalizedRowWidgets = rowWidgets.map((widget, index) => ({
        widget,
        placement: rowPlacements[index]
      }));
      return distributeRowWidth(normalizedRowWidgets);
    });
    return balanceDashboardTabWidgets(nextTab) || nextTab;
  });
}

export function applyDashboardRowPreset(
  dashboard: DashboardDefinition,
  tabId: string,
  rowIndex: number,
  preset: DashboardRowLayoutPreset
) {
  return updateDashboardTab(dashboard, tabId, (tab) => {
    const nextTab = updateDashboardRowWidgets(tab, rowIndex, (rowWidgets) => {
      const widths = supportedRowPresetWidths(rowWidgets, preset);
      if (!widths) return rowWidgets;
      return applyWidthsToWidgets(rowWidgets, widths);
    });
    return balanceDashboardTabWidgets(nextTab) || nextTab;
  });
}

export function moveDashboardWidget(
  dashboard: DashboardDefinition,
  tabId: string,
  widgetId: string,
  direction: -1 | 1
) {
  return updateDashboardTab(dashboard, tabId, (tab) => {
    const widgets = [...tab.widgets];
    const currentIndex = widgets.findIndex((item) => item.id === widgetId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= widgets.length) return tab;
    const [widget] = widgets.splice(currentIndex, 1);
    widgets.splice(nextIndex, 0, widget);
    return compactDashboardTabWidgets({ ...tab, widgets }) || tab;
  });
}

export function moveDashboardWidgetToEdge(
  dashboard: DashboardDefinition,
  tabId: string,
  widgetId: string,
  edge: "start" | "end"
) {
  return updateDashboardTab(dashboard, tabId, (tab) => {
    const widgets = [...tab.widgets];
    const currentIndex = widgets.findIndex((item) => item.id === widgetId);
    if (currentIndex < 0) return tab;
    const [widget] = widgets.splice(currentIndex, 1);
    if (edge === "start") widgets.unshift(widget);
    else widgets.push(widget);
    return compactDashboardTabWidgets({ ...tab, widgets }) || tab;
  });
}

export function reorderDashboardWidget(
  dashboard: DashboardDefinition,
  tabId: string,
  sourceWidgetId: string,
  targetWidgetId: string
) {
  if (sourceWidgetId === targetWidgetId) return dashboard;
  return updateDashboardTab(dashboard, tabId, (tab) => {
    const widgets = [...tab.widgets];
    const fromIndex = widgets.findIndex((item) => item.id === sourceWidgetId);
    const toIndex = widgets.findIndex((item) => item.id === targetWidgetId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return tab;
    const [widget] = widgets.splice(fromIndex, 1);
    widgets.splice(toIndex, 0, widget);
    return compactDashboardTabWidgets({ ...tab, widgets }) || tab;
  });
}

export function reorderDashboardWidgetToIndex(
  dashboard: DashboardDefinition,
  tabId: string,
  widgetId: string,
  targetIndex: number
) {
  return updateDashboardTab(dashboard, tabId, (tab) => ({
    ...(compactDashboardTabWidgets({
      ...tab,
      widgets: moveWidgetAtIndex(tab.widgets, widgetId, targetIndex)
    }) || tab)
  }));
}

export function reorderDashboardWidgetToRowEdge(
  dashboard: DashboardDefinition,
  tabId: string,
  widgetId: string,
  targetRowIndex: number,
  edge: DashboardWidgetRowEdge = "start"
) {
  return updateDashboardTab(dashboard, tabId, (tab) => {
    const rows = getDashboardWidgetRows(tab);
    const targetRow = rows[targetRowIndex];
    if (!targetRow) return tab;
    const targetIndex = edge === "start" ? targetRow.startIndex : targetRow.endIndex + 1;
    return {
      ...(compactDashboardTabWidgets({
        ...tab,
        widgets: moveWidgetAtIndex(tab.widgets, widgetId, targetIndex)
      }) || tab)
    };
  });
}

export function reorderDashboardWidgetByDropPosition(
  dashboard: DashboardDefinition,
  tabId: string,
  sourceWidgetId: string,
  targetWidgetId: string,
  position: DashboardWidgetDropPosition = "before"
) {
  return updateDashboardTab(dashboard, tabId, (tab) => {
    const targetIndex = tab.widgets.findIndex((widget) => widget.id === targetWidgetId);
    if (targetIndex < 0) return tab;
    return {
      ...(compactDashboardTabWidgets({
        ...tab,
        widgets: moveWidgetAtIndex(tab.widgets, sourceWidgetId, targetIndex + (position === "after" ? 1 : 0))
      }) || tab)
    };
  });
}

export function removeDashboardWidget(
  dashboard: DashboardDefinition,
  tabId: string,
  widgetId: string
) {
  return updateDashboardTab(dashboard, tabId, (tab) => ({
    ...(compactDashboardTabWidgets({
      ...tab,
      widgets: tab.widgets.filter((widget) => widget.id !== widgetId)
    }) || tab)
  }));
}

export function applyDashboardWidgetLayout(
  dashboard: DashboardDefinition,
  tabId: string,
  widgetId: string,
  layout: { w: number; h: number; x?: number; y?: number }
) {
  return updateDashboardTab(dashboard, tabId, (tab) => ({
    ...compactDashboardTabWidgets({
      ...tab,
      widgets: tab.widgets.map((widget) => widget.id === widgetId
        ? {
            ...widget,
            layout: normalizeDashboardWidgetLayout(widget, {
              ...widget.layout,
              w: layout.w,
              h: layout.h,
              ...(Number.isFinite(Number(layout.x)) ? { x: Number(layout.x) } : {}),
              ...(Number.isFinite(Number(layout.y)) ? { y: Number(layout.y) } : {})
            })
          }
        : widget)
    })!
  }));
}

export function placeDashboardWidgetAtPosition(
  dashboard: DashboardDefinition,
  tabId: string,
  widgetId: string,
  position: { x: number; y: number }
) {
  return updateDashboardTab(dashboard, tabId, (tab) => {
    const widgets = sortWidgetsByGridPreference(
      tab.widgets.map((widget) => widget.id === widgetId
        ? {
            ...widget,
            layout: normalizeDashboardWidgetLayout(widget, {
              ...widget.layout,
              x: position.x,
              y: position.y
            })
          }
        : widget),
      widgetId
    );
    return compactDashboardTabWidgets({ ...tab, widgets }) || tab;
  });
}

export function moveDashboardWidgetByDirection(
  dashboard: DashboardDefinition,
  tabId: string,
  widgetId: string,
  direction: DashboardWidgetMoveDirection
) {
  return updateDashboardTab(dashboard, tabId, (tab) => {
    const targetPlacement = findDirectionalPlacement(tab, widgetId, direction);
    if (!targetPlacement) return tab;
    const targetIndex = targetPlacement.index + (direction === "right" ? 1 : 0);
    return {
      ...(compactDashboardTabWidgets({
        ...tab,
        widgets: moveWidgetAtIndex(tab.widgets, widgetId, targetIndex)
      }) || tab)
    };
  });
}

export function moveDashboardWidgetByRow(
  dashboard: DashboardDefinition,
  tabId: string,
  widgetId: string,
  direction: "up" | "down",
  edge: DashboardWidgetRowEdge = direction === "up" ? "start" : "end"
) {
  return updateDashboardTab(dashboard, tabId, (tab) => {
    const rows = getDashboardWidgetRows(tab);
    const currentRowIndex = rows.findIndex((row) => row.widgetIds.includes(widgetId));
    if (currentRowIndex < 0) return tab;
    const targetRowIndex = currentRowIndex + (direction === "up" ? -1 : 1);
    const targetRow = rows[targetRowIndex];
    if (!targetRow) return tab;
    const currentRow = rows[currentRowIndex];
    const targetIndex = direction === "down"
      ? currentRow.endIndex + 1
      : Math.max(0, currentRow.startIndex - 1);
    return {
      ...(compactDashboardTabWidgets({
        ...tab,
        widgets: moveWidgetAtIndex(
          tab.widgets,
          widgetId,
          edge === "start" && direction === "up"
            ? targetRow.startIndex
            : targetIndex
        )
      }) || tab)
    };
  });
}

export function toggleDashboardWidgetFullWidth(
  dashboard: DashboardDefinition,
  tabId: string,
  widgetId: string,
  restoredWidth = 6
) {
  return updateDashboardTab(dashboard, tabId, (tab) => ({
    ...compactDashboardTabWidgets({
      ...tab,
      widgets: tab.widgets.map((widget) => widget.id === widgetId
        ? {
            ...widget,
            layout: {
              ...normalizeDashboardWidgetLayout(widget, {
                ...widget.layout,
                w: normalizeDashboardWidgetLayout(widget).w >= 12 ? restoredWidth : 12
              })
            }
          }
        : widget)
    })!
  }));
}

export function duplicateDashboardWidget(
  dashboard: DashboardDefinition,
  tabId: string,
  widgetId: string,
  createId: () => string
) {
  let duplicatedWidgetId = "";
  const nextDashboard = updateDashboardTab(dashboard, tabId, (tab) => {
    const widgets = [...tab.widgets];
    const widgetIndex = widgets.findIndex((item) => item.id === widgetId);
    if (widgetIndex < 0) return tab;
    const source = widgets[widgetIndex];
    duplicatedWidgetId = createId();
    const duplicate: WidgetDefinition = {
      ...clone(source),
      id: duplicatedWidgetId,
      title: source.title ? `${source.title} Copy` : "Card Copy",
      layout: normalizeDashboardWidgetLayout(source)
    };
    widgets.splice(widgetIndex + 1, 0, duplicate);
    return compactDashboardTabWidgets({ ...tab, widgets }) || tab;
  });
  return {
    dashboard: nextDashboard,
    widgetId: duplicatedWidgetId
  };
}

export function insertDashboardWidget(
  dashboard: DashboardDefinition,
  tabId: string,
  widget: WidgetDefinition,
  afterWidgetId = ""
) {
  return updateDashboardTab(dashboard, tabId, (tab) => {
    const widgets = [...tab.widgets];
    const insertIndex = afterWidgetId ? widgets.findIndex((item) => item.id === afterWidgetId) + 1 : widgets.length;
    widgets.splice(Math.max(0, insertIndex), 0, {
      ...clone(widget),
      layout: normalizeDashboardWidgetLayout(widget)
    });
    return compactDashboardTabWidgets({ ...tab, widgets }) || tab;
  });
}

export function moveDashboardWidgetToTab(
  dashboard: DashboardDefinition,
  sourceTabId: string,
  widgetId: string,
  targetTabId: string
) {
  if (sourceTabId === targetTabId) return dashboard;
  const nextDashboard = clone(dashboard);
  const sourceTab = nextDashboard.tabs.find((tab) => tab.id === sourceTabId);
  const targetTab = nextDashboard.tabs.find((tab) => tab.id === targetTabId);
  if (!sourceTab || !targetTab) return dashboard;
  const widgetIndex = sourceTab.widgets.findIndex((widget) => widget.id === widgetId);
  if (widgetIndex < 0) return dashboard;
  const [widget] = sourceTab.widgets.splice(widgetIndex, 1);
  targetTab.widgets.push(widget);
  const balancedSource = compactDashboardTabWidgets(sourceTab);
  const balancedTarget = compactDashboardTabWidgets(targetTab);
  if (balancedSource) sourceTab.widgets = balancedSource.widgets;
  if (balancedTarget) targetTab.widgets = balancedTarget.widgets;
  return nextDashboard;
}

export function copyDashboardWidgetToTab(
  dashboard: DashboardDefinition,
  sourceTabId: string,
  widgetId: string,
  targetTabId: string,
  createId: () => string
) {
  const nextDashboard = clone(dashboard);
  const sourceTab = nextDashboard.tabs.find((tab) => tab.id === sourceTabId);
  const targetTab = nextDashboard.tabs.find((tab) => tab.id === targetTabId);
  if (!sourceTab || !targetTab) {
    return {
      dashboard,
      widgetId: ""
    };
  }
  const sourceWidget = sourceTab.widgets.find((widget) => widget.id === widgetId);
  if (!sourceWidget) {
    return {
      dashboard,
      widgetId: ""
    };
  }
  const nextWidgetId = createId();
  const duplicate: WidgetDefinition = {
    ...clone(sourceWidget),
    id: nextWidgetId,
    title: sourceWidget.title ? `${sourceWidget.title} Copy` : "Card Copy",
    layout: normalizeDashboardWidgetLayout(sourceWidget)
  };
  targetTab.widgets.push(duplicate);
  const balancedTarget = compactDashboardTabWidgets(targetTab);
  if (balancedTarget) targetTab.widgets = balancedTarget.widgets;
  return {
    dashboard: nextDashboard,
    widgetId: nextWidgetId
  };
}
