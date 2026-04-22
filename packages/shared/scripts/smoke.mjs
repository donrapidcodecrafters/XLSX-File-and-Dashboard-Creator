import assert from "node:assert/strict";
import {
  applyDashboardWidgetLayout,
  applyDashboardRowPreset,
  balanceDashboardLayout,
  balanceDashboardRow,
  balanceDashboardTabWidgets,
  buildDashboardFilters,
  buildStudioCatalogItemLookup,
  buildStudioBuilderDraft,
  buildStudioDocument,
  copyDashboardWidgetToTab,
  filterStudioLibraryItems,
  duplicateDashboardWidget,
  getDashboardWidgetPlacements,
  getDashboardWidgetRows,
  getDashboardWidgetLayoutBounds,
  getStudioObjectScopeLabel,
  getStudioBuilderDraftIssues,
  getStudioBuilderStepIssues,
  getStudioBuilderStepLabel,
  getStudioBuilderSteps,
  insertDashboardWidget,
  isStudioItemVisibleToCurrentUser,
  moveDashboardWidget,
  moveDashboardWidgetByRow,
  moveDashboardWidgetByDirection,
  moveDashboardWidgetToTab,
  moveDashboardWidgetToEdge,
  normalizeDashboardWidgetLayout,
  placeDashboardWidgetAtPosition,
  previewDashboardWidgetPlacementsByDropPosition,
  previewDashboardWidgetPlacementsToRowEdge,
  previewDashboardWidgetPlacementsToTabEnd,
  normalizeStudioBuilderScopeOwner,
  normalizeStudioDocument,
  removeDashboardWidget,
  reorderDashboardWidget,
  reorderDashboardWidgetByDropPosition,
  reorderDashboardWidgetToIndex,
  reorderDashboardWidgetToRowEdge,
  resolveActiveDashboardTabId,
  resolveStudioSessionStatus,
  resolveSelectedDashboardWidgetId,
  touchStudioSession,
  runReport
} from "../dist/index.js";

function testSeededReportOverrides() {
  const document = buildStudioDocument();
  const override = document.personalOverrides.reports["report-project-portfolio"];
  assert.ok(override, "expected a seeded personal override for report-project-portfolio");
  assert.equal(override.currentPage, 1);
  assert.equal(override.focusMode, "default");
  assert.equal(override.savedViews[0]?.focusMode, "chart");
  const dashboardOverride = document.personalOverrides.dashboards["dashboard-executive-pulse"];
  assert.equal(dashboardOverride.savedViews[0]?.name, "Open Overview");
}

function testOverrideNormalization() {
  const document = normalizeStudioDocument({
    personalOverrides: {
      dashboards: {},
      reports: {
        "report-project-portfolio": {
          currentPage: -4,
          focusMode: "not-a-real-mode",
          focusedSection: "not-real",
          savedViews: [{
            id: "bad-view",
            name: "Bad View",
            currentPage: -2,
            focusMode: "not-a-real-mode",
            focusedSection: "not-real"
          }],
          updatedAt: "2026-01-20T00:00:00.000Z"
        }
      }
    }
  });
  const override = document.personalOverrides.reports["report-project-portfolio"];
  assert.equal(override.currentPage, 1);
  assert.equal(override.focusMode, "default");
  assert.equal(override.focusedSection, "");
  assert.equal(override.savedViews[0]?.currentPage, 1);
  assert.equal(override.savedViews[0]?.focusMode, "default");
}

function testReportExecutionAndDashboardFilters() {
  const document = buildStudioDocument();
  const report = document.bundle.objects["report-project-portfolio"];
  const table = document.bundle.tables.find((item) => item.id === report.sourceTableId);
  assert.ok(table, "expected source table for seeded report");
  const result = runReport(report, table, document.bundle.data[report.sourceTableId] || []);
  assert.ok(result.totalRows > 0, "expected seeded report to return rows");
  assert.ok(result.summary.length > 0, "expected seeded report to produce summary metrics");
  assert.ok(result.chartData.length > 0, "expected seeded report to produce chart data");

  const dashboard = document.bundle.objects["dashboard-executive-pulse"];
  const filters = buildDashboardFilters(dashboard, "report-task-pipeline", {
    "runtime-status": "Blocked",
    "runtime-start-date": "CURRENT_MONTH"
  });
  assert.ok(filters.some((filter) => filter.fieldId === "status" && filter.value === "Blocked"), "expected dashboard runtime filter to target the task report");
}

function testDashboardEditorHelpers() {
  const document = buildStudioDocument();
  const dashboard = document.bundle.objects["dashboard-executive-pulse"];
  const activeTabId = resolveActiveDashboardTabId(dashboard, "missing-tab");
  assert.equal(activeTabId, dashboard.tabs[0].id, "expected active tab fallback to first tab");

  const activeTab = dashboard.tabs.find((tab) => tab.id === activeTabId);
  const selectedWidgetId = resolveSelectedDashboardWidgetId(activeTab, "missing-widget");
  assert.equal(selectedWidgetId, activeTab.widgets[0].id, "expected selected widget fallback to first widget");

  const movedDown = moveDashboardWidget(dashboard, activeTab.id, activeTab.widgets[0].id, 1);
  assert.equal(movedDown.tabs[0].widgets[1].id, activeTab.widgets[0].id, "expected widget move down to reorder tab widgets");

  const movedToEnd = moveDashboardWidgetToEdge(dashboard, activeTab.id, activeTab.widgets[0].id, "end");
  assert.equal(movedToEnd.tabs[0].widgets[movedToEnd.tabs[0].widgets.length - 1].id, activeTab.widgets[0].id, "expected widget move-to-end to place widget last");

  const reordered = reorderDashboardWidget(dashboard, activeTab.id, activeTab.widgets[0].id, activeTab.widgets[1].id);
  assert.equal(reordered.tabs[0].widgets[1].id, activeTab.widgets[0].id, "expected drag reorder helper to move source widget to target position");

  const reorderedAfter = reorderDashboardWidgetByDropPosition(dashboard, activeTab.id, activeTab.widgets[0].id, activeTab.widgets[1].id, "after");
  assert.equal(reorderedAfter.tabs[0].widgets[0].id, activeTab.widgets[1].id, "expected drop-position helper to preserve target before inserting after it");
  assert.equal(reorderedAfter.tabs[0].widgets[1].id, activeTab.widgets[0].id, "expected drop-position helper to insert source after target");

  const movedToIndex = reorderDashboardWidgetToIndex(dashboard, activeTab.id, activeTab.widgets[0].id, activeTab.widgets.length);
  assert.equal(movedToIndex.tabs[0].widgets[movedToIndex.tabs[0].widgets.length - 1].id, activeTab.widgets[0].id, "expected reorder-to-index helper to place source at requested slot");

  const resized = applyDashboardWidgetLayout(dashboard, activeTab.id, activeTab.widgets[0].id, { w: 12, h: 6 });
  assert.equal(resized.tabs[0].widgets[0].layout.w, 12, "expected layout helper to apply width preset");
  assert.equal(resized.tabs[0].widgets[0].layout.h, 6, "expected layout helper to apply height preset");

  const duplicated = duplicateDashboardWidget(dashboard, activeTab.id, activeTab.widgets[0].id, () => "widget-duplicate-test");
  assert.equal(duplicated.widgetId, "widget-duplicate-test");
  assert.ok(
    duplicated.dashboard.tabs[0].widgets.some((widget) => widget.id === "widget-duplicate-test"),
    "expected duplicate helper to create the requested duplicate card"
  );

  const inserted = insertDashboardWidget(dashboard, activeTab.id, {
    id: "widget-inserted-test",
    title: "Inserted",
    mode: "linked",
    displayMode: "inherit",
    showDetails: false,
    showSummary: true,
    reportId: "report-project-portfolio",
    layout: { w: 6, h: 4 }
  }, activeTab.widgets[0].id);
  assert.ok(
    inserted.tabs[0].widgets.some((widget) => widget.id === "widget-inserted-test"),
    "expected insert helper to add the requested widget to the target tab"
  );

  const removed = removeDashboardWidget(dashboard, activeTab.id, activeTab.widgets[0].id);
  assert.equal(removed.tabs[0].widgets.length, activeTab.widgets.length - 1, "expected remove helper to drop one widget");

  const targetTab = dashboard.tabs[1];
  assert.ok(targetTab, "expected seeded dashboard to include a second tab");

  const movedToTab = moveDashboardWidgetToTab(dashboard, activeTab.id, activeTab.widgets[0].id, targetTab.id);
  assert.ok(!movedToTab.tabs[0].widgets.some((widget) => widget.id === activeTab.widgets[0].id), "expected move-to-tab helper to remove widget from source tab");
  assert.equal(movedToTab.tabs[1].widgets[movedToTab.tabs[1].widgets.length - 1].id, activeTab.widgets[0].id, "expected move-to-tab helper to append widget to target tab");

  const copiedToTab = copyDashboardWidgetToTab(dashboard, activeTab.id, activeTab.widgets[0].id, targetTab.id, () => "widget-copy-to-tab-test");
  assert.equal(copiedToTab.widgetId, "widget-copy-to-tab-test", "expected copy-to-tab helper to return created widget id");
  assert.equal(copiedToTab.dashboard.tabs[1].widgets[copiedToTab.dashboard.tabs[1].widgets.length - 1].id, "widget-copy-to-tab-test", "expected copy-to-tab helper to append duplicate to target tab");

  const summaryWidget = {
    ...activeTab.widgets[0],
    displayMode: "summary",
    showSummary: true,
    showDetails: false,
    layout: { w: 1, h: 1 }
  };
  const summaryBounds = getDashboardWidgetLayoutBounds(summaryWidget);
  assert.equal(summaryBounds.minW, 2, "expected summary cards to keep a smaller minimum width");
  assert.equal(normalizeDashboardWidgetLayout(summaryWidget).h, 2, "expected summary cards to normalize to their minimum height");

  const tableWidget = {
    ...activeTab.widgets[0],
    displayMode: "table",
    showDetails: true,
    showSummary: false,
    layout: { w: 2, h: 2 }
  };
  assert.equal(normalizeDashboardWidgetLayout(tableWidget).w, 4, "expected table cards to keep a larger readable minimum width");
  assert.equal(normalizeDashboardWidgetLayout(tableWidget).h, 4, "expected detail-heavy table cards to keep a larger minimum height");

  const placements = getDashboardWidgetPlacements(activeTab);
  assert.equal(placements[0].startCol, 1, "expected placement planner to start the first widget in column one");
  assert.ok(placements[1].startCol > placements[0].startCol, "expected placement planner to pack the second widget to the right when space remains");
  const rows = getDashboardWidgetRows(activeTab);
  assert.ok(rows.length >= 1, "expected row planner to derive at least one row");
  assert.equal(rows[0].startIndex, 0, "expected first row metadata to preserve the first widget index");
  assert.ok(rows[0].widgetIds.length >= 1, "expected row planner to keep widget ids");

  const layoutDashboard = {
    ...dashboard,
    tabs: [{
      ...activeTab,
      widgets: [
        { ...activeTab.widgets[0], id: "widget-a", layout: { w: 4, h: 4 } },
        { ...activeTab.widgets[1], id: "widget-b", layout: { w: 4, h: 4 } },
        { ...activeTab.widgets[0], id: "widget-c", layout: { w: 4, h: 4 } },
        { ...activeTab.widgets[1], id: "widget-d", layout: { w: 12, h: 3 } }
      ]
    }, ...dashboard.tabs.slice(1)]
  };
  const layoutTab = layoutDashboard.tabs[0];
  const movedRight = moveDashboardWidgetByDirection(layoutDashboard, layoutTab.id, "widget-a", "right");
  assert.equal(movedRight.tabs[0].widgets[1].id, "widget-a", "expected right-move helper to move a card after its row neighbor");
  const movedDownByGrid = moveDashboardWidgetByDirection(layoutDashboard, layoutTab.id, "widget-a", "down");
  assert.equal(movedDownByGrid.tabs[0].widgets[2].id, "widget-a", "expected down-move helper to push a card later in the grid order when moving toward the next row");
  const movedToNextRow = moveDashboardWidgetByRow(layoutDashboard, layoutTab.id, "widget-a", "down");
  assert.equal(movedToNextRow.tabs[0].widgets[2].id, "widget-a", "expected row-move helper to move a card after the rest of its current row");
  const movedToRowStart = reorderDashboardWidgetToRowEdge(layoutDashboard, layoutTab.id, "widget-c", 0, "start");
  assert.equal(getDashboardWidgetRows(movedToRowStart.tabs[0])[0]?.widgetIds[0], "widget-c", "expected row-edge helper to move a card to the start of a target row");
  const movedToRowEnd = reorderDashboardWidgetToRowEdge(layoutDashboard, layoutTab.id, "widget-a", 1, "end");
  assert.equal(
    getDashboardWidgetRows(movedToRowEnd.tabs[0])[0]?.widgetIds[getDashboardWidgetRows(movedToRowEnd.tabs[0])[0].widgetIds.length - 1],
    "widget-a",
    "expected row-edge helper to move a card to the end of the resolved row"
  );
  const balancedSingleRow = balanceDashboardRow(layoutDashboard, layoutTab.id, 0);
  assert.equal(
    balancedSingleRow.tabs[0].widgets.slice(0, 3).reduce((sum, widget) => sum + widget.layout.w, 0),
    12,
    "expected row-balance helper to fill the selected row width"
  );
  const equalRow = applyDashboardRowPreset(layoutDashboard, layoutTab.id, 0, "equal");
  assert.deepEqual(
    equalRow.tabs[0].widgets.slice(0, 3).map((widget) => widget.layout.w),
    [4, 4, 4],
    "expected equal row preset to split a three-card row evenly"
  );
  const wideRightRow = applyDashboardRowPreset(layoutDashboard, layoutTab.id, 0, "wide-right");
  assert.deepEqual(
    wideRightRow.tabs[0].widgets.slice(0, 3).map((widget) => widget.layout.w),
    [3, 3, 6],
    "expected wide-right row preset to emphasize the last card in the row"
  );
  const positioned = placeDashboardWidgetAtPosition(layoutDashboard, layoutTab.id, "widget-c", { x: 9, y: 1 });
  const positionedPlacement = getDashboardWidgetPlacements(positioned.tabs[0]).find((placement) => placement.widgetId === "widget-c");
  assert.equal(positionedPlacement?.startCol, 9, "expected explicit widget placement helper to honor requested X position when space is available");
  assert.equal(positioned.tabs[0].widgets.find((widget) => widget.id === "widget-c")?.layout.x, 9, "expected compacted widgets to persist their resolved X coordinate");
  assert.equal(positioned.tabs[0].widgets.find((widget) => widget.id === "widget-c")?.layout.y, 1, "expected compacted widgets to persist their resolved Y coordinate");
  const movedIntoLowerBand = placeDashboardWidgetAtPosition(layoutDashboard, layoutTab.id, "widget-a", { x: 1, y: 5 });
  const lowerBandPlacement = getDashboardWidgetPlacements(movedIntoLowerBand.tabs[0]).find((placement) => placement.widgetId === "widget-a");
  assert.ok(
    (lowerBandPlacement?.startRow || 0) >= 5,
    "expected explicit widget placement helper to prioritize the dropped widget in a lower grid band"
  );
  const previewAfter = previewDashboardWidgetPlacementsByDropPosition(layoutTab, "widget-a", "widget-b", "after");
  assert.ok(
    (previewAfter.find((placement) => placement.widgetId === "widget-a")?.startCol || 0)
      > (getDashboardWidgetPlacements(layoutTab).find((placement) => placement.widgetId === "widget-a")?.startCol || 0),
    "expected drop-position preview helper to show the dragged widget moving after its target"
  );
  const previewRowEnd = previewDashboardWidgetPlacementsToRowEdge(layoutTab, "widget-a", 1, "end");
  assert.ok(
    (previewRowEnd.find((placement) => placement.widgetId === "widget-a")?.index || 0)
      !== (getDashboardWidgetPlacements(layoutTab).find((placement) => placement.widgetId === "widget-a")?.index || 0),
    "expected row-edge preview helper to reorder the dragged widget before drop"
  );
  const previewTabEnd = previewDashboardWidgetPlacementsToTabEnd(layoutTab, "widget-a");
  assert.equal(
    previewTabEnd[previewTabEnd.length - 1]?.widgetId,
    "widget-a",
    "expected tab-end preview helper to place the dragged widget last"
  );

  const unbalancedTab = {
    ...activeTab,
    widgets: [
      { ...activeTab.widgets[0], id: "widget-balance-a", displayMode: "summary", showSummary: true, showDetails: false, layout: { w: 4, h: 3 } },
      { ...activeTab.widgets[1], id: "widget-balance-b", displayMode: "summary", showSummary: true, showDetails: false, layout: { w: 4, h: 3 } }
    ]
  };
  const balancedTab = balanceDashboardTabWidgets(unbalancedTab);
  assert.equal(
    balancedTab.widgets.reduce((sum, widget) => sum + widget.layout.w, 0),
    12,
    "expected tab balancing to fill leftover row width when widgets can grow"
  );

  const balancedDashboard = balanceDashboardLayout({
    ...dashboard,
    tabs: [unbalancedTab, targetTab]
  });
  assert.equal(
    balancedDashboard.tabs[0].widgets.reduce((sum, widget) => sum + widget.layout.w, 0),
    12,
    "expected dashboard-wide balancing to apply across tabs"
  );
  assert.ok(
    balancedDashboard.tabs[0].widgets.every((widget) => widget.layout.x >= 1 && widget.layout.y >= 1),
    "expected balanced widgets to persist resolved grid coordinates"
  );
}

function testStudioBuilderHelpers() {
  const document = buildStudioDocument();
  const table = document.bundle.tables[0];
  assert.ok(table, "expected seeded table for builder helpers");

  const reportDraft = buildStudioBuilderDraft(table, "report", "user-123", () => "metric-seed");
  assert.equal(reportDraft.name, "New Report");
  assert.equal(reportDraft.summaryMetrics[0]?.id, "metric-seed");
  assert.deepEqual(getStudioBuilderSteps("report"), ["basics", "data", "filters", "view", "review"]);
  assert.deepEqual(getStudioBuilderSteps("dashboard"), ["basics", "layout", "review"]);
  assert.equal(getStudioBuilderStepLabel("review"), "Review");
  assert.deepEqual(normalizeStudioBuilderScopeOwner("personal", "user-123"), { scope: "personal", ownerUserId: "user-123" });

  const invalidReportDraft = {
    ...reportDraft,
    name: "",
    selectedFieldIds: [],
    view: {
      ...reportDraft.view,
      mode: "chart",
      chartFieldId: "",
      chartAggregation: "sum",
      chartValueFieldId: ""
    }
  };
  const issues = getStudioBuilderDraftIssues(invalidReportDraft, table, "user-123");
  assert.ok(issues.some((issue) => issue.includes("Enter a name")), "expected draft validation to require a name");
  assert.ok(issues.some((issue) => issue.includes("Select at least one detail field")), "expected draft validation to require detail fields when details are enabled");
  assert.ok(issues.some((issue) => issue.includes("X axis field")), "expected draft validation to require a chart axis field");
  assert.ok(issues.some((issue) => issue.includes("value field")), "expected draft validation to require a chart value field");

  const basicsIssues = getStudioBuilderStepIssues("basics", invalidReportDraft, table, "user-123");
  assert.ok(basicsIssues.some((issue) => issue.includes("Enter a name before continuing")), "expected basics step validation to stay scoped to basics");
  const viewIssues = getStudioBuilderStepIssues("view", invalidReportDraft, table, "user-123");
  assert.ok(viewIssues.every((issue) => issue.includes("chart")), "expected view step issues to stay scoped to chart and mode configuration");
}

function testStudioLibraryHelpers() {
  const document = buildStudioDocument();
  const currentUserId = "demo.user";
  const personalReport = document.bundle.objects["report-my-active-projects"];
  const visibleObjects = filterStudioLibraryItems(Object.values(document.bundle.objects), { currentUserId });
  assert.ok(visibleObjects.some((object) => object.id === personalReport.id), "expected owner to see personal report");

  const filteredObjects = filterStudioLibraryItems(Object.values(document.bundle.objects), {
    currentUserId,
    query: personalReport.name.split(" ")[0] || personalReport.name,
    typeFilter: "report",
    scopeFilter: "personal",
    favorites: [personalReport.id],
    recentIds: [personalReport.id],
    favoritesOnly: true,
    recentOnly: true
  });
  assert.deepEqual(filteredObjects.map((object) => object.id), [personalReport.id]);

  const hiddenFromOtherUser = filterStudioLibraryItems(Object.values(document.bundle.objects), {
    currentUserId: "someone.else",
    scopeFilter: "personal"
  });
  assert.equal(hiddenFromOtherUser.length, 0, "expected personal objects to be hidden from other sessions");

  const catalogLookup = buildStudioCatalogItemLookup([], document.bundle.objects);
  assert.ok(catalogLookup.has("dashboard-executive-pulse"), "expected catalog lookup helper to backfill bundle-only objects");
  assert.equal(getStudioObjectScopeLabel(personalReport), "Personal");
  assert.equal(isStudioItemVisibleToCurrentUser(personalReport, currentUserId), true);
  assert.equal(isStudioItemVisibleToCurrentUser(personalReport, "someone.else"), false);
}

function testStudioSessionHelpers() {
  const document = buildStudioDocument();
  const relaunched = touchStudioSession(document.session, {
    now: "2026-04-21T18:00:00.000Z",
    relaunch: true,
    launchSource: "quickbase-button",
    currentUserId: "demo.user",
    launchRealmHostname: "cadencec.quickbase.com",
    launchAppId: "bva8ar4ad"
  });
  assert.equal(relaunched.launchSource, "quickbase-button");
  assert.equal(relaunched.launchRealmHostname, "cadencec.quickbase.com");
  assert.equal(relaunched.launchAppId, "bva8ar4ad");
  assert.equal(relaunched.lastActivityAt, "2026-04-21T18:00:00.000Z");
  assert.ok(relaunched.expiresAt > relaunched.lastActivityAt, "expected relaunch to extend the expiry");

  const expiredStatus = resolveStudioSessionStatus({
    ...relaunched,
    requiresLaunch: true,
    expiresAt: "2026-04-21T18:05:00.000Z"
  }, "2026-04-21T18:06:00.000Z");
  assert.equal(expiredStatus.valid, false, "expected session to expire after its deadline");
  assert.equal(expiredStatus.expired, true);

  const localStatus = resolveStudioSessionStatus({
    ...relaunched,
    launchSource: "local-dev",
    requiresLaunch: true,
    expiresAt: "2026-04-21T18:05:00.000Z"
  }, "2026-04-21T18:06:00.000Z");
  assert.ok(localStatus.message.includes("Local development session expired"), "expected local-dev expiry message");

  const mismatchedLaunch = resolveStudioSessionStatus(relaunched, "2026-04-21T18:01:00.000Z", {
    launchSource: "quickbase-button",
    currentUserId: "someone.else",
    launchRealmHostname: "cadencec.quickbase.com",
    launchAppId: "bva8ar4ad"
  });
  assert.equal(mismatchedLaunch.valid, false, "expected Quickbase user mismatch to invalidate the session");
}

testSeededReportOverrides();
testOverrideNormalization();
testReportExecutionAndDashboardFilters();
testDashboardEditorHelpers();
testStudioBuilderHelpers();
testStudioLibraryHelpers();
testStudioSessionHelpers();

console.log("shared smoke tests passed");
