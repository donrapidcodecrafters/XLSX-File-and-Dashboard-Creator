import JSZip from "jszip";

/**
 * Some xlsx-writing tools (confirmed: at least the source system behind real
 * user-uploaded files) serialize xlsx packages in ways that are valid per the
 * OOXML/OPC spec but that ExcelJS's parsers — both the streaming WorkbookReader
 * and the plain Workbook#load — don't tolerate, silently producing a broken model
 * instead of a real xlsx-format error. This repackages the buffer to route around
 * both issues we've seen so far, before ExcelJS ever touches it. Packages that
 * don't exhibit either issue (the overwhelming majority of real-world xlsx files)
 * are returned completely untouched — the JSZip round-trip only happens when at
 * least one part actually needed a fix.
 *
 * 1. Namespace-PREFIXED parts (e.g. `<x:workbook>`/`<x:sheet>` in xl/workbook.xml,
 *    `<ap:Properties>` in docProps/app.xml) instead of the far more common default/
 *    unprefixed namespace (`<workbook xmlns="...">`). ExcelJS's SAX parsers do
 *    plain string matching on unprefixed tag names ("workbook", "sheets",
 *    "Properties", ...) — a prefixed document never matches any of them, so
 *    parsing finishes without ever populating the model, and something downstream
 *    crashes with an opaque "Cannot read properties of undefined". Fixed by
 *    detecting whichever prefix each part's ROOT element specifically uses (not
 *    any prefix appearing anywhere in the document — plenty of entirely normal
 *    parts have an unprefixed root while still legitimately using a prefix like
 *    `vt:` on certain child elements for a secondary namespace) and stripping
 *    just that root prefix throughout the part.
 *
 * 2. Relationship (.rels) Targets given as package-ABSOLUTE paths
 *    (`Target="/xl/tables/table1.xml"`) instead of the conventional path relative
 *    to the part the .rels file describes (`Target="../tables/table1.xml"`). Both
 *    are valid per the OPC spec, but ExcelJS's own internal relationship-target
 *    handling is inconsistent about it: some lookups (e.g. worksheets, styles)
 *    tolerate a leading `/xl/`, but at least the table-relationship lookup in
 *    WorksheetXform#reconcile does a naive `options.tables[rel.Target]` string
 *    match against a key it always builds in the relative form — an absolute
 *    Target simply never matches, and `table.name` on the resulting `undefined`
 *    throws. Fixed by resolving every absolute Target into the equivalent
 *    relative-to-source-part path before ExcelJS ever reads the .rels file.
 */
export async function normalizeXlsxNamespacePrefix(buffer: Buffer): Promise<Buffer> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return buffer; // not a valid zip at all — let the caller's own error handling surface it
  }

  let changed = false;

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;

    if (entry.name.endsWith(".rels")) {
      const xml = await entry.async("string");
      const sourcePartDir = sourcePartDirFor(entry.name);
      const fixed = xml.replace(/Target="(\/[^"]+)"/g, (whole, target: string) => {
        const relative = toRelativeTarget(sourcePartDir, target);
        return relative === target ? whole : `Target="${relative}"`;
      });
      if (fixed !== xml) {
        zip.file(entry.name, fixed);
        changed = true;
      }
      continue;
    }

    if (!entry.name.endsWith(".xml") || !isUnprefixedByConvention(entry.name)) continue;
    const xml = await entry.async("string");
    // Only the ROOT element's own prefix, not any prefix appearing anywhere in the
    // document — plenty of entirely normal OOXML parts (docProps/app.xml, e.g.)
    // have an UNPREFIXED root while still legitimately using a prefix like `vt:`
    // on specific child elements for a secondary namespace. Treating any such
    // child prefix as "the whole document's prefix" would incorrectly rewrite it,
    // producing a duplicate xmlns attribute when the root already declares one.
    const afterDeclaration = xml.replace(/^\uFEFF/, "").replace(/^<\?xml[^>]*\?>/, "").replace(/^\s+/, "");
    const rootMatch = afterDeclaration.match(/^<([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)\b/);
    if (!rootMatch) continue;
    const prefix = rootMatch[1];
    const xmlnsMatch = xml.match(new RegExp(`xmlns:${prefix}="([^"]+)"`));
    if (!xmlnsMatch) continue; // prefix used but never declared — leave it alone, not what we're fixing
    const namespaceUri = xmlnsMatch[1];
    const escapedNs = namespaceUri.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const stripped = xml
      .replace(new RegExp(`<${prefix}:`, "g"), "<")
      .replace(new RegExp(`</${prefix}:`, "g"), "</")
      .replace(new RegExp(`xmlns:${prefix}="${escapedNs}"`), `xmlns="${namespaceUri}"`);
    zip.file(entry.name, stripped);
    changed = true;
  }

  if (!changed) return buffer;
  return zip.generateAsync({ type: "nodebuffer" });
}

/**
 * Whether ExcelJS's own parser for this specific part expects an UNPREFIXED root
 * element. This is an explicit allowlist, not a blanket "everything under xl/"
 * rule — plenty of parts under xl/ are the OPPOSITE case, where ExcelJS's own
 * writer (and every other real-world xlsx tool) always emits them prefixed and
 * the parser's lookup keys are literally those prefixed strings, so stripping the
 * prefix there breaks otherwise-perfectly-normal files instead of fixing
 * anything. Confirmed opposite-case examples that must NOT be touched:
 * docProps/core.xml (`<cp:coreProperties>`, `<dc:creator>`, ...) and
 * xl/drawings/*.xml (`<xdr:wsDr>`, `<xdr:twoCellAnchor>`, ...) — both broke real
 * imports the first two times this allowlist was widened past what's listed here.
 * There's no reliable way to infer "prefixed or unprefixed expected" from a
 * part's own content, so only add an entry here once it's been verified against
 * ExcelJS's actual xform source (does it switch/lookup on the bare tag name, or
 * on the prefixed one?), not by guessing from what "looks like" a data part.
 */
function isUnprefixedByConvention(partName: string): boolean {
  if (partName === "xl/workbook.xml") return true;
  if (partName === "xl/styles.xml") return true;
  if (partName === "xl/sharedStrings.xml") return true;
  if (/^xl\/worksheets\/sheet\d+\.xml$/.test(partName)) return true;
  if (/^xl\/tables\/table\d+\.xml$/.test(partName)) return true;
  if (partName === "docProps/app.xml") return true;
  return false;
}

/** The directory (in the package) of the part a .rels file at `relsPath` describes. */
function sourcePartDirFor(relsPath: string): string {
  // e.g. "xl/worksheets/_rels/sheet1.xml.rels" describes "xl/worksheets/sheet1.xml"
  // e.g. "_rels/.rels" describes the package root
  const withoutRelsSuffix = relsPath.replace(/\.rels$/, "");
  const sourcePartPath = withoutRelsSuffix.replace(/(^|\/)_rels\/([^/]+)$/, "$1$2");
  const slashIndex = sourcePartPath.lastIndexOf("/");
  return slashIndex === -1 ? "" : sourcePartPath.slice(0, slashIndex);
}

/** Resolves a package-absolute Target ("/xl/tables/table1.xml") into the path
 *  relative to `sourceDir` that ExcelJS's own relationship lookups expect
 *  ("../tables/table1.xml"). Non-absolute targets pass through unchanged. */
function toRelativeTarget(sourceDir: string, target: string): string {
  if (!target.startsWith("/")) return target;
  const targetParts = target.replace(/^\/+/, "").split("/").filter(Boolean);
  const sourceDirParts = sourceDir.split("/").filter(Boolean);
  let common = 0;
  while (common < sourceDirParts.length && common < targetParts.length && sourceDirParts[common] === targetParts[common]) {
    common += 1;
  }
  const ups = sourceDirParts.length - common;
  const relParts = [...Array(ups).fill(".."), ...targetParts.slice(common)];
  return relParts.join("/") || ".";
}
