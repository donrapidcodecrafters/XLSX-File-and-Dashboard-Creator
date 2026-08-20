// Not part of `npm run smoke` — needs a real local Postgres, same as
// upsert-import-smoke.mjs (create it first: `createdb import_upsert_test`).
// Run manually after `npm run build`: node ./scripts/header-skip-rows-smoke.mjs
//
// Reproduces the exact bug reported in production: a workbook with title/
// filter-summary rows above the real header row (e.g. an "Accounts Receivable"
// export with "Filters: ALL Agencies...", "Generated on...", a blank row, THEN
// the real headers on row 5) gets misread — without headerSkipRows, the title
// row itself becomes a single bogus column and all real data is lost.
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { pathToFileURL } from "node:url";

process.env.DATABASE_URL = "postgresql://" + (process.env.USER || "postgres") + "@localhost:5432/import_upsert_test";
process.env.POSTGRES_AUTO_MIGRATE = "true";

const { ensureEnterpriseSchema } = await import("../dist/db/schema.js");
const { ingestXlsxWorkbookSourceStream } = await import("../dist/services/xlsx-source-ingest.js");
const { getSourceRecordSummary, loadSourceRows } = await import("../dist/services/eav-record-store.js");

export async function buildWorkbookBuffer() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Accounts Receivable");
  ws.addRow(["Accounts Receivable"]);
  ws.addRow(["Filters: ALL Agencies, ALL Branches, ALL Insurance Types, ALL Insurances"]);
  ws.addRow(["Generated on 08/03/2026 12:46:04 PM by Connie Fitzwater"]);
  ws.addRow([]);
  ws.addRow(["Agency Type", "Agency", "Patient Last Name", "Balance"]);
  ws.addRow(["Home Health", "Clearwater", "Pfeffer", 1250.5]);
  ws.addRow(["Home Health", "Clearwater", "Trotter", 430]);
  ws.addRow(["Home Health", "Tampa", "Hartford", 980.25]);
  const firstPass = Buffer.from(await wb.xlsx.writeBuffer());
  // ExcelJS's streaming WorkbookReader expects relationship/sheet metadata that a
  // freshly-in-memory-built workbook doesn't always populate the same way a
  // round-tripped (or genuinely Excel-authored) file does — load + re-save once so
  // the buffer matches what the real streaming ingest path actually receives.
  const normalize = new ExcelJS.Workbook();
  await normalize.xlsx.load(firstPass);
  return Buffer.from(await normalize.xlsx.writeBuffer());
}

async function main() {
  await ensureEnterpriseSchema();

  // --- Test 1: without headerSkipRows, the title row is misread as headers ---
  const sourceIdBroken = "test:ar-broken";
  const brokenResult = await ingestXlsxWorkbookSourceStream({
    filename: "Accounts Receivable.xlsx",
    stream: await buildWorkbookBuffer(),
    sourceId: sourceIdBroken,
    sourceName: "AR Broken"
  });
  const brokenSource = brokenResult.sources[0];
  assert.equal(brokenSource.fieldCount, 1, "without headerSkipRows: expected the title row to be misread as a single bogus column");
  console.log("ok   confirmed the bug reproduces without headerSkipRows (1 bogus column)");

  // --- Test 2: with headerSkipRows: 4, the real header row (row 5) is used correctly ---
  const sourceId = "test:ar-fixed";
  const fixed = await ingestXlsxWorkbookSourceStream({
    filename: "Accounts Receivable.xlsx",
    stream: await buildWorkbookBuffer(),
    sourceId,
    sourceName: "AR Fixed",
    headerSkipRows: 4
  });
  const source = fixed.sources[0];
  assert.equal(source.fieldCount, 4, "expected 4 real columns once the title/blank rows are skipped");
  assert.equal(source.rowCount, 3, "expected 3 real data rows");
  const fieldLabels = source.table.fields.map((f) => f.label);
  assert.deepEqual(fieldLabels, ["Agency Type", "Agency", "Patient Last Name", "Balance"], "expected the real header row's labels");
  const rows = await loadSourceRows(sourceId, 10);
  const balanceFieldId = source.table.fields.find((f) => f.label === "Balance").id;
  assert.deepEqual(rows.map((r) => r[balanceFieldId]).sort((a, b) => a - b), [430, 980.25, 1250.5], "expected the real numeric data, not title-row junk");
  console.log("ok   headerSkipRows: 4 correctly skips the title block and imports real data");

  // --- Test 3: headerSkipRows is persisted for the next import ---
  const summary = await getSourceRecordSummary([sourceId]);
  assert.equal(summary?.headerSkipRows, 4, "expected headerSkipRows to be remembered on the source");
  console.log("ok   headerSkipRows persisted for next import");

  // --- Test 4: re-import without specifying headerSkipRows falls back to the saved value ---
  const reimport = await ingestXlsxWorkbookSourceStream({
    filename: "Accounts Receivable.xlsx",
    stream: await buildWorkbookBuffer(),
    sourceId,
    sourceName: "AR Fixed"
    // headerSkipRows intentionally omitted
  });
  assert.equal(reimport.sources[0].fieldCount, 4, "expected the saved headerSkipRows (4) to apply automatically when the caller omits it");
  console.log("ok   re-import without headerSkipRows falls back to the saved value automatically");

  console.log("header-skip-rows-smoke passed");
}

// Only run when executed directly (`node header-skip-rows-smoke.mjs`) — importing
// buildWorkbookBuffer elsewhere must not re-run this suite as a side effect.
// pathToFileURL (not a manual `file://` + path concat) correctly percent-encodes
// paths with spaces, matching import.meta.url's format.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
