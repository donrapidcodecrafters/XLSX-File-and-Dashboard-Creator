// Not part of `npm run smoke` — this needs a real local Postgres and creates/uses
// a throwaway `import_upsert_test` database (create it first: `createdb import_upsert_test`).
// Run manually after `npm run build`: node ./scripts/upsert-import-smoke.mjs
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://" + (process.env.USER || "postgres") + "@localhost:5432/import_upsert_test";
process.env.POSTGRES_AUTO_MIGRATE = "true";

const { ensureEnterpriseSchema } = await import("../dist/db/schema.js");
const { replaceSourceRecordsFromBatches, loadSourceRows, getSourceRecordSummary } = await import("../dist/services/eav-record-store.js");
const { pgQuery } = await import("../dist/db/postgres.js");

async function ingest(sourceId, rows, keyFieldIds) {
  return replaceSourceRecordsFromBatches(
    { sourceId, sourceName: "Test Source", sourceType: "xlsx", keyFieldIds },
    async (writer) => {
      await writer.appendRows(rows);
      return {
        fields: [
          { id: "sku", label: "SKU", type: "text" },
          { id: "qty", label: "Qty", type: "number" }
        ],
        rowCount: rows.length
      };
    }
  );
}

async function rowIdsBySku(sourceId) {
  const result = await pgQuery(
    `SELECT external_record_id, id, payload FROM app_records WHERE source_id = $1 ORDER BY id`,
    [sourceId]
  );
  return result.rows;
}

async function main() {
  await ensureEnterpriseSchema();

  // --- Test 1: keyed upsert preserves row identity, computes added/updated/removed ---
  const sourceId = "test:upsert-widgets";
  const first = await ingest(sourceId, [
    { sku: "A-1", qty: 10 },
    { sku: "A-2", qty: 20 },
    { sku: "A-3", qty: 30 }
  ], ["sku"]);
  assert.equal(first.upsert?.added, 3, "first import: expected 3 added");
  assert.equal(first.upsert?.updated, 0, "first import: expected 0 updated");
  assert.equal(first.upsert?.removed, 0, "first import: expected 0 removed");
  const rowsAfterFirst = await rowIdsBySku(sourceId);
  const idBySku = Object.fromEntries(rowsAfterFirst.map((r) => [r.external_record_id, r.id]));

  // Re-import: A-1 unchanged, A-2 value changed, A-3 removed, A-4 new
  const second = await ingest(sourceId, [
    { sku: "A-1", qty: 10 },
    { sku: "A-2", qty: 999 },
    { sku: "A-4", qty: 40 }
  ], ["sku"]);
  assert.equal(second.upsert?.added, 1, "second import: expected 1 added (A-4)");
  assert.equal(second.upsert?.updated, 2, "second import: expected 2 updated (A-1, A-2)");
  assert.equal(second.upsert?.removed, 1, "second import: expected 1 removed (A-3)");

  const rowsAfterSecond = await rowIdsBySku(sourceId);
  assert.equal(rowsAfterSecond.length, 3, "expected 3 rows after second import");
  const a1 = rowsAfterSecond.find((r) => r.external_record_id === Object.keys(idBySku).find((k) => idBySku[k] === idBySku[Object.keys(idBySku)[0]]));
  const bySkuAfter = {};
  for (const r of rowsAfterSecond) bySkuAfter[r.payload.sku] = r;
  assert.equal(bySkuAfter["A-1"].id, idBySku[Object.keys(idBySku).find((k) => true)] ?? bySkuAfter["A-1"].id, "sanity");
  // Row identity check: A-1's row id must be IDENTICAL across imports (true upsert, not delete+reinsert)
  const firstRowsBySku = {};
  for (const r of rowsAfterFirst) firstRowsBySku[r.payload.sku] = r;
  assert.equal(bySkuAfter["A-1"].id, firstRowsBySku["A-1"].id, "A-1 row id should be preserved across re-import (true upsert)");
  assert.equal(bySkuAfter["A-2"].id, firstRowsBySku["A-2"].id, "A-2 row id should be preserved across re-import (true upsert)");
  assert.equal(bySkuAfter["A-2"].payload.qty, 999, "A-2 value should be updated in place");
  assert.ok(!bySkuAfter["A-3"], "A-3 should have been removed");
  assert.ok(bySkuAfter["A-4"], "A-4 should have been added");
  console.log("ok   keyed upsert: identity preserved, added/updated/removed correct");

  // --- Test 2: key fields persisted and returned via getSourceRecordSummary ---
  const summary = await getSourceRecordSummary([sourceId]);
  assert.deepEqual(summary?.keyFieldIds, ["sku"], "expected keyFieldIds to persist");
  console.log("ok   keyFieldIds persisted on app_entities");

  // --- Test 3: duplicate key within one file is rejected, and rolls back (no partial write) ---
  const beforeDupAttempt = await rowIdsBySku(sourceId);
  let dupError = null;
  try {
    await ingest(sourceId, [
      { sku: "B-1", qty: 1 },
      { sku: "B-1", qty: 2 }
    ], ["sku"]);
  } catch (error) {
    dupError = error;
  }
  assert.ok(dupError, "expected duplicate key import to throw");
  assert.match(String(dupError.message), /same key field value/i, "expected duplicate-key error message");
  const afterDupAttempt = await rowIdsBySku(sourceId);
  assert.equal(afterDupAttempt.length, beforeDupAttempt.length, "duplicate-key import must not partially commit");
  console.log("ok   duplicate key within a file rejected, no partial write");

  // --- Test 4: missing key field column is rejected ---
  let missingFieldError = null;
  try {
    await replaceSourceRecordsFromBatches(
      { sourceId, sourceName: "Test Source", sourceType: "xlsx", keyFieldIds: ["not_a_real_field"] },
      async (writer) => {
        await writer.appendRows([{ sku: "C-1", qty: 1 }]);
        return { fields: [{ id: "sku", label: "SKU", type: "text" }, { id: "qty", label: "Qty", type: "number" }], rowCount: 1 };
      }
    );
  } catch (error) {
    missingFieldError = error;
  }
  assert.ok(missingFieldError, "expected missing key field import to throw");
  assert.match(String(missingFieldError.message), /not found in this file's columns/i, "expected missing-key-field error message");
  console.log("ok   missing key field column rejected");

  // --- Test 5: non-keyed sources still do full delete+reinsert (regression check) ---
  const plainSourceId = "test:plain-widgets";
  await ingest(plainSourceId, [{ sku: "P-1", qty: 1 }], undefined);
  const plainFirst = await rowIdsBySku(plainSourceId);
  await ingest(plainSourceId, [{ sku: "P-1", qty: 1 }], undefined);
  const plainSecond = await rowIdsBySku(plainSourceId);
  assert.notEqual(plainFirst[0].id, plainSecond[0].id, "non-keyed re-import should still fully replace rows (different row id)");
  console.log("ok   non-keyed sources unaffected (still full delete+reinsert)");

  console.log("all upsert-import smoke tests passed");
}

await main();
process.exit(0);
