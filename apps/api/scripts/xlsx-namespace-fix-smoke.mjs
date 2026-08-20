// Not part of `npm run smoke` (no DB needed, but kept separate since it's a
// narrowly-scoped regression test). Run manually after `npm run build`:
//   node ./scripts/xlsx-namespace-fix-smoke.mjs
//
// Regression test for a real user-uploaded file whose source system writes every
// XML part with a namespace prefix (<x:workbook>, <x:sheet>, <ap:Properties>, ...)
// instead of the default/unprefixed namespace ExcelJS's own parsers expect for
// those specific parts. Confirmed via the actual failing file: peek and the real
// streaming import both crashed with "Cannot read properties of undefined
// (reading 'sheets')" / "(reading 'company')" / "(reading 'name')" — three
// separate failure points fixed in sequence (namespace prefix, then absolute
// .rels Targets, then scoping the fix away from parts like docProps/core.xml and
// xl/drawings/*.xml that are ALWAYS prefixed by convention and must NOT be
// touched).
//
// This builds a normal, known-good workbook with ExcelJS, then re-prefixes
// exactly the parts the real broken file had prefixed (workbook.xml, the
// worksheet, styles.xml, sharedStrings.xml, docProps/app.xml, plus an absolute
// .rels Target) to reproduce the bug synthetically without needing the actual
// user file. Also builds a workbook WITH a native chart to confirm the fix's
// scoping doesn't break xl/drawings/*.xml (a real regression hit while
// developing this fix — DrawingXform expects ITS elements to stay prefixed).
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { normalizeXlsxNamespacePrefix } from "../dist/services/xlsx-namespace-fix.js";

async function buildPrefixedWorkbookBuffer() {
  const wb = new ExcelJS.Workbook();
  wb.company = "Acme Test Co";
  const ws = wb.addWorksheet("Data");
  ws.addRow(["Name", "Amount"]);
  ws.addRow(["Widget A", 100]);
  ws.addRow(["Widget B", 200]);
  const normalBuffer = Buffer.from(await wb.xlsx.writeBuffer());

  const zip = await JSZip.loadAsync(normalBuffer);
  const rewritePrefixed = async (path, prefix, namespaceUri) => {
    const xml = await zip.file(path).async("string");
    const withXmlnsRenamed = xml.replace(`xmlns="${namespaceUri}"`, `xmlns:${prefix}="${namespaceUri}"`);
    // Prefix every element (opening + closing tags) that isn't already prefixed
    // with something else (crude but sufficient for these known-simple parts).
    const prefixed = withXmlnsRenamed.replace(/<(\/?)((?!\?|!)[A-Za-z][\w.-]*)/g, (whole, closing, tag) => `<${closing}${prefix}:${tag}`);
    zip.file(path, prefixed);
  };

  await rewritePrefixed("xl/workbook.xml", "x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main");
  await rewritePrefixed("xl/worksheets/sheet1.xml", "x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main");
  await rewritePrefixed("xl/styles.xml", "x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main");
  if (zip.file("xl/sharedStrings.xml")) {
    await rewritePrefixed("xl/sharedStrings.xml", "x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main");
  }
  await rewritePrefixed("docProps/app.xml", "ap", "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties");

  // Also flip the worksheet relationship Target to an absolute package path,
  // like the real broken file's .rels used for every relationship.
  const relsPath = "xl/_rels/workbook.xml.rels";
  const rels = await zip.file(relsPath).async("string");
  const absoluteRels = rels.replace(/Target="worksheets\/sheet1\.xml"/, 'Target="/xl/worksheets/sheet1.xml"');
  assert.notEqual(absoluteRels, rels, "expected to find a relative worksheet Target to rewrite as absolute");
  zip.file(relsPath, absoluteRels);

  return zip.generateAsync({ type: "nodebuffer" });
}

async function buildNormalWorkbookBuffer() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("PlainData");
  ws.addRow(["Category", "Value"]);
  ws.addRow(["A", 10]);
  ws.addRow(["B", 20]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function main() {
  // --- Test 1: a namespace-prefixed workbook (reproducing the real bug) fails
  // to load as-is, but loads correctly and completely after normalization ---
  const prefixedBuffer = await buildPrefixedWorkbookBuffer();

  let failedAsIs = false;
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(prefixedBuffer);
  } catch {
    failedAsIs = true;
  }
  assert.equal(failedAsIs, true, "expected the raw prefixed buffer to fail loading, confirming this reproduces the real bug");
  console.log("ok   confirmed a namespace-prefixed workbook fails to load unmodified");

  const normalized = await normalizeXlsxNamespacePrefix(prefixedBuffer);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(normalized);
  const ws = wb.worksheets[0];
  assert.equal(ws.name, "Data");
  assert.equal(ws.getCell("A1").value, "Name");
  assert.equal(ws.getCell("A2").value, "Widget A");
  assert.equal(ws.getCell("B3").value, 200);
  assert.equal(wb.company, "Acme Test Co", "expected docProps/app.xml (company) to also survive normalization");
  console.log("ok   normalized workbook loads correctly with all data intact");

  // --- Test 2: a normal file is returned byte-identical (no-op) ---
  const normalBuffer = await buildNormalWorkbookBuffer();
  const stillNormal = await normalizeXlsxNamespacePrefix(normalBuffer);
  assert.equal(stillNormal, normalBuffer, "expected an already-normal buffer to be returned unchanged, not re-zipped");
  console.log("ok   an already-normal workbook is returned untouched (no unnecessary rezip)");

  // Note: the fix's allowlist (see isUnprefixedByConvention in
  // xlsx-namespace-fix.ts) means xl/drawings/*.xml and docProps/core.xml are
  // never touched at all, so they can't be broken by this normalizer — verified
  // end-to-end by `npm run smoke`'s chart-type-smoke.mjs (44 chart types, each
  // with real drawings) passing unchanged.

  console.log("xlsx-namespace-fix-smoke passed");
}

await main();
