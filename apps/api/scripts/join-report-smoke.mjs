// Verifies multi-source joined reports (ReportDefinition.sourceJoins) actually
// produce correct row=row matched data — left join, inner join, composite
// (multi-column) keys, unmatched rows, and that a chart built on a joined
// report correctly aggregates a field pulled from the secondary source.
import assert from "node:assert/strict";
import {
  buildStudioDocument,
  runReport,
  mergeJoinedRows,
  buildMergedTableForJoins,
  joinedFieldId,
  autoDetectJoinConditions
} from "../../../packages/shared/dist/index.js";

const ordersTable = {
  id: "table-orders",
  name: "Orders",
  description: "",
  fields: [
    { id: "orderId", label: "Order ID", type: "text" },
    { id: "customerId", label: "Customer ID", type: "text" },
    { id: "region", label: "Region", type: "text" }, // duplicate label on purpose (see composite-key test)
    { id: "amount", label: "Amount", type: "number" }
  ]
};

const customersTable = {
  id: "table-customers",
  name: "Customers",
  description: "",
  fields: [
    { id: "custId", label: "Customer ID", type: "text" },
    { id: "region", label: "Region", type: "text" },
    { id: "tier", label: "Tier", type: "text" }
  ]
};

const orderRows = [
  { orderId: "O-1", customerId: "C-1", region: "East", amount: 100 },
  { orderId: "O-2", customerId: "C-1", region: "East", amount: 50 },
  { orderId: "O-3", customerId: "C-2", region: "West", amount: 200 },
  { orderId: "O-4", customerId: "C-9", region: "East", amount: 75 } // no matching customer
];

const customerRows = [
  { custId: "C-1", region: "East", tier: "Gold" },
  { custId: "C-2", region: "West", tier: "Silver" },
  // Same custId, different region — only relevant to the composite-key row match
  { custId: "C-1", region: "West", tier: "Bronze" }
];

function makeReport(base, overrides) {
  return {
    ...base,
    id: `report-join-smoke-${Math.random().toString(36).slice(2, 8)}`,
    // Clear anything inherited from the template that could constrain/reshape
    // results against synthetic data it was never designed for.
    filters: [],
    filterTree: undefined,
    groups: [],
    sorts: [],
    summaryMetrics: [],
    ...overrides,
    view: { ...base.view, ...(overrides.view || {}) }
  };
}

async function main() {
  const document = buildStudioDocument();
  const templateReport = document.bundle.objects["report-project-portfolio"];
  assert.ok(templateReport?.type === "report", "expected a seed report to use as a template");

  // --- Test 1: single-key LEFT join ---
  {
    const join = { id: "join-1", sourceTableId: customersTable.id, joinType: "left", conditions: [
      { id: "c1", parentFieldId: "customerId", childFieldId: "custId" }
    ] };
    const mergedTable = buildMergedTableForJoins(ordersTable, [join], [customersTable]);
    const mergedRows = mergeJoinedRows(orderRows, [{ join, table: customersTable, rows: customerRows }]);

    const tierFieldId = joinedFieldId(customersTable.id, "tier");
    const report = makeReport(templateReport, {
      sourceTableId: ordersTable.id,
      sourceJoins: [join],
      selectedFieldIds: ["orderId", "customerId", "amount", tierFieldId],
      view: { mode: "table" }
    });
    const result = runReport(report, mergedTable, mergedRows);
    // C-1 has 2 orders (O-1, O-2), each matching 2 customer rows (East Gold, West Bronze) = 4 rows.
    // C-2 has 1 order (O-3), matching 1 customer row (West Silver) = 1 row.
    // C-9 has 1 order (O-4), matching no customer row — left join keeps it (nulled) = 1 row.
    assert.equal(result.totalRows, 6, "left join: 4 (C-1 x2 orders x2 matches) + 1 (O-3) + 1 (O-4 unmatched, kept) = 6");
    const o1Rows = result.rows.filter((r) => r.orderId === "O-1");
    assert.equal(o1Rows.length, 2, "O-1 (customerId=C-1) should match both C-1 customer rows on a single-key join");
    assert.ok(o1Rows.some((r) => r[tierFieldId] === "Gold") && o1Rows.some((r) => r[tierFieldId] === "Bronze"), "O-1 should show both matched tiers");
    const rawO4 = mergedRows.find((r) => r.orderId === "O-4");
    assert.equal(rawO4[tierFieldId], null, "at the merge-engine level (before display projection), an unmatched left-join field is a real null");
    const o4 = result.rows.find((r) => r.orderId === "O-4");
    assert.ok(o4, "left join must keep the unmatched row O-4");
    // mergeJoinedRows() itself sets null for an unmatched left-join field; runReport()'s
    // row projection then normalizes missing/null values to "" for display, same as any
    // other blank field — verified separately at the merge level in Test 3 below.
    assert.equal(o4[tierFieldId], "", "unmatched left-join row's joined field should project to blank, like any other empty field");
    console.log("ok   single-key left join: correct row=row matching, unmatched rows kept with nulls");
  }

  // --- Test 2: single-key INNER join drops unmatched rows ---
  {
    const join = { id: "join-2", sourceTableId: customersTable.id, joinType: "inner", conditions: [
      { id: "c1", parentFieldId: "customerId", childFieldId: "custId" }
    ] };
    const mergedRows = mergeJoinedRows(orderRows, [{ join, table: customersTable, rows: customerRows }]);
    assert.ok(!mergedRows.some((r) => r.orderId === "O-4"), "inner join must drop O-4 (no matching customer)");
    assert.equal(mergedRows.length, 5, "inner join: 4 (C-1 x2 orders x2 matches) + 1 (O-3) = 5, O-4 dropped entirely");
    console.log("ok   inner join drops unmatched rows");
  }

  // --- Test 3: composite (multi-column) key narrows the match correctly ---
  {
    const join = { id: "join-3", sourceTableId: customersTable.id, joinType: "left", conditions: [
      { id: "c1", parentFieldId: "customerId", childFieldId: "custId" },
      { id: "c2", parentFieldId: "region", childFieldId: "region" }
    ] };
    const mergedRows = mergeJoinedRows(orderRows, [{ join, table: customersTable, rows: customerRows }]);
    const o1Rows = mergedRows.filter((r) => r.orderId === "O-1");
    assert.equal(o1Rows.length, 1, "composite key (customerId+region) should narrow C-1/East to exactly one customer match, not both C-1 rows");
    const tierFieldId = joinedFieldId(customersTable.id, "tier");
    assert.equal(o1Rows[0][tierFieldId], "Gold", "composite key should match the East C-1 row (Gold), not the West C-1 row (Bronze)");
    console.log("ok   composite (multi-column) key correctly disambiguates duplicate single-column keys");
  }

  // --- Test 4: auto-detect suggests the matching key by field label ---
  {
    const suggestions = autoDetectJoinConditions(ordersTable, customersTable);
    assert.ok(suggestions.some((s) => s.parentFieldId === "region" && s.childFieldId === "region"), "auto-detect should suggest Region <-> Region by label match");
    console.log("ok   auto-detect join conditions finds label-matching columns");
  }

  // --- Test 5: a chart built on a joined report aggregates a secondary-source field ---
  {
    const join = { id: "join-5", sourceTableId: customersTable.id, joinType: "left", conditions: [
      { id: "c1", parentFieldId: "customerId", childFieldId: "custId" },
      { id: "c2", parentFieldId: "region", childFieldId: "region" }
    ] };
    const mergedTable = buildMergedTableForJoins(ordersTable, [join], [customersTable]);
    const mergedRows = mergeJoinedRows(orderRows, [{ join, table: customersTable, rows: customerRows }]);
    const tierFieldId = joinedFieldId(customersTable.id, "tier");
    const report = makeReport(templateReport, {
      sourceTableId: ordersTable.id,
      sourceJoins: [join],
      selectedFieldIds: ["orderId", "amount", tierFieldId],
      view: {
        mode: "chart",
        chartType: "bar",
        chartFieldId: tierFieldId,
        chartAggregation: "sum",
        chartValueFieldId: "amount"
      }
    });
    const result = runReport(report, mergedTable, mergedRows);
    assert.ok(result.chartData.length > 0, "expected chart data grouped by the joined (secondary-source) field");
    const gold = result.chartData.find((d) => String(d.rawLabel ?? d.label) === "Gold");
    assert.ok(gold, "expected a 'Gold' category from the joined tier field");
    assert.equal(gold.value, 150, "Gold tier (C-1/East) should sum O-1(100)+O-2(50) = 150");
    console.log("ok   chart on a joined report correctly aggregates a secondary-source field");
  }

  console.log("all multi-source join smoke tests passed");
}

await main();
