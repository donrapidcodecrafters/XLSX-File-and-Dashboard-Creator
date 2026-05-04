import { XMLParser } from "fast-xml-parser";
import type { FastifyInstance } from "fastify";
import { collectFilterFieldIds, createFilterGroup, runReport, type ReportDefinition, type TableDefinition } from "@studio/shared";
import { loadQuickbaseSchema } from "../services/quickbase-schema.js";
import { fetchQuickbaseTableRows } from "../services/quickbase-storage.js";
import { studioStore } from "../services/studio-store.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "value",
  trimValues: true
});

function getCachedRowsForTable(tableId: string, limit = 1000) {
  const target = String(tableId || "").trim();
  if (!target) return [];
  const document = studioStore.getLiveDocument();
  const table = document.bundle.tables.find((item) => item.id === target || item.quickbaseTableId === target);
  const rows = document.bundle.data[target]
    || (table?.id ? document.bundle.data[table.id] : undefined)
    || (table?.quickbaseTableId ? document.bundle.data[table.quickbaseTableId] : undefined)
    || [];
  return Array.isArray(rows) ? rows.slice(0, Math.max(1, limit)) : [];
}

function escapeXml(value: string) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function textValue(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    const text = (value as Record<string, unknown>).value;
    return typeof text === "string" ? text : "";
  }
  return "";
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function fetchQuickbaseApps(body: {
  realmHostname?: string;
  userToken?: string;
  appToken?: string;
}) {
  const hostname = String(body.realmHostname || "").trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
  if (!hostname || !body.userToken) {
    throw new Error("Realm hostname and user token are required to look up apps.");
  }
  const response = await fetch(`https://${hostname}/db/main`, {
    method: "POST",
    headers: {
      "Content-Type": "application/xml",
      "QUICKBASE-ACTION": "API_GrantedDBs"
    },
    body: [
      "<qdbapi>",
      `<usertoken>${escapeXml(body.userToken || "")}</usertoken>`,
      body.appToken ? `<apptoken>${escapeXml(body.appToken)}</apptoken>` : "",
      "<realmAppsOnly>true</realmAppsOnly>",
      "<excludeparents>0</excludeparents>",
      "<withembeddedtables>0</withembeddedtables>",
      "</qdbapi>"
    ].join("")
  });
  const xml = await response.text();
  if (!response.ok) {
    throw new Error(`Quickbase app lookup failed with status ${response.status}.`);
  }
  const parsed = parser.parse(xml) as any;
  const api = parsed?.qdbapi;
  const errcode = Number(api?.errcode ?? 0);
  if (errcode !== 0) {
    throw new Error(api?.errtext || "Quickbase app lookup failed.");
  }
  return asArray(api?.databases?.dbinfo)
    .map((entry: any) => ({
      id: textValue(entry?.dbid),
      name: textValue(entry?.dbname)
    }))
    .filter((entry) => entry.id && entry.name)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function registerQuickbaseRoutes(app: FastifyInstance) {
  app.post("/api/quickbase/apps", async (request, reply) => {
    const body = (request.body as {
      realmHostname?: string;
      userToken?: string;
      appToken?: string;
    } | undefined) || {};

    try {
      const apps = await fetchQuickbaseApps(body);
      return { apps };
    } catch (error) {
      reply.code(400);
      return {
        message: error instanceof Error ? error.message : "Quickbase app lookup failed."
      };
    }
  });

  app.post("/api/quickbase/schema", async (request, reply) => {
    const body = (request.body as {
      realmHostname?: string;
      userToken?: string;
      appToken?: string;
      appId?: string;
    } | undefined) || {};

    try {
      const schema = await loadQuickbaseSchema({
        realmHostname: body.realmHostname || "",
        userToken: body.userToken || "",
        appToken: body.appToken || "",
        appId: body.appId || ""
      });
      return { schema };
    } catch (error) {
      reply.code(400);
      return {
        message: error instanceof Error ? error.message : "Quickbase schema lookup failed."
      };
    }
  });

  app.post("/api/quickbase/table-preview", async (request, reply) => {
    const body = (request.body as {
      realmHostname?: string;
      userToken?: string;
      appToken?: string;
      appId?: string;
      tableId?: string;
      fieldIds?: string[];
      top?: number;
    } | undefined) || {};

    try {
      const cachedRows = getCachedRowsForTable(body.tableId || "", body.top || 250);
      if (cachedRows.length) {
        return { rows: cachedRows };
      }
      const rows = await fetchQuickbaseTableRows({
        realmHostname: body.realmHostname || "",
        userToken: body.userToken || "",
        appToken: body.appToken || "",
        appId: body.appId || "",
        apiBaseUrl: "https://api.quickbase.com/v1",
        helpdeskAppDbid: "",
        helpdeskTicketsTableDbid: "",
        helpdeskParentTableDbid: "",
        helpdeskParentAppIdFid: "",
        objectTableId: "",
        objectKeyFieldId: "",
        objectTypeFieldId: "",
        objectNameFieldId: "",
        objectConfigFieldId: "",
        objectOwnerFieldId: "",
        objectPersonalOwnerFieldId: "",
        objectUpdatedAtFieldId: "",
        objectUpdatedByFieldId: "",
        rosterTableId: "",
        rosterUserIdFieldId: "",
        rosterEmployeeNameFieldId: "",
        rosterEmployeeEmailFieldId: "",
        rosterEmployeeRecordIdFieldId: "",
        settingsTableId: "",
        settingsUserFieldId: "",
        settingsObjectFieldId: "",
        settingsObjectKeyFieldId: "",
        settingsJsonFieldId: "",
        settingsUpdatedByFieldId: "",
        versionTableId: "",
        versionObjectFieldId: "",
        versionObjectKeyFieldId: "",
        versionSnapshotFieldId: "",
        versionChangedAtFieldId: "",
        versionChangedByFieldId: "",
        versionUpdatedByFieldId: ""
      }, body.tableId || "", body.fieldIds || [], { top: Math.min(body.top || 250, 250) });
      return { rows };
    } catch (error) {
      request.log.warn({
        tableId: body.tableId || "",
        fieldCount: Array.isArray(body.fieldIds) ? body.fieldIds.length : 0,
        fieldIds: Array.isArray(body.fieldIds) ? body.fieldIds.slice(0, 12) : [],
        top: body.top || 250,
        error: error instanceof Error ? error.message : error
      }, "quickbase table preview failed");
      reply.code(400);
      return {
        message: error instanceof Error
          ? error.message
          : `Quickbase table preview failed for table ${body.tableId || "(missing table id)"}.`
      };
    }
  });

  app.post("/api/quickbase/report-preview", async (request, reply) => {
    const body = (request.body as {
      quickbase?: {
        realmHostname?: string;
        userToken?: string;
        appToken?: string;
        appId?: string;
      };
      report?: ReportDefinition;
      table?: TableDefinition;
    } | undefined) || {};

    try {
      const report = body.report;
      const table = body.table;
      if (!report || !table) {
        reply.code(400);
        return { message: "Report and table are required." };
      }
      const fieldIds = Array.from(new Set(
        [
          ...(report.selectedFieldIds || []),
          ...collectFilterFieldIds(report.filterTree || createFilterGroup("and", report.filters || [])),
          ...(report.groups || []).map((item) => item.fieldId),
          ...(report.sorts || []).map((item) => item.fieldId),
          ...((report.summaryMetrics || []).map((item) => item.fieldId)),
          report.view.chartFieldId,
          report.view.chartSeriesFieldId,
          report.view.chartValueFieldId,
          report.view.chartSecondaryValueFieldId,
          report.view.timelineDateField,
          report.view.timelineEndField,
          report.view.calendarDateField,
          report.view.kanbanField,
          report.view.titleFieldId
        ].filter(Boolean).map(String)
      ));

      const cachedRows = getCachedRowsForTable(table.quickbaseTableId || table.id, 1000);
      const rows = cachedRows.length ? cachedRows : await fetchQuickbaseTableRows({
        realmHostname: body.quickbase?.realmHostname || "",
        userToken: body.quickbase?.userToken || "",
        appToken: body.quickbase?.appToken || "",
        appId: body.quickbase?.appId || "",
        apiBaseUrl: "https://api.quickbase.com/v1",
        helpdeskAppDbid: "",
        helpdeskTicketsTableDbid: "",
        helpdeskParentTableDbid: "",
        helpdeskParentAppIdFid: "",
        objectTableId: "",
        objectKeyFieldId: "",
        objectTypeFieldId: "",
        objectNameFieldId: "",
        objectConfigFieldId: "",
        objectOwnerFieldId: "",
        objectPersonalOwnerFieldId: "",
        objectUpdatedAtFieldId: "",
        objectUpdatedByFieldId: "",
        rosterTableId: "",
        rosterUserIdFieldId: "",
        rosterEmployeeNameFieldId: "",
        rosterEmployeeEmailFieldId: "",
        rosterEmployeeRecordIdFieldId: "",
        settingsTableId: "",
        settingsUserFieldId: "",
        settingsObjectFieldId: "",
        settingsObjectKeyFieldId: "",
        settingsJsonFieldId: "",
        settingsUpdatedByFieldId: "",
        versionTableId: "",
        versionObjectFieldId: "",
        versionObjectKeyFieldId: "",
        versionSnapshotFieldId: "",
        versionChangedAtFieldId: "",
        versionChangedByFieldId: "",
        versionUpdatedByFieldId: ""
      }, table.quickbaseTableId || table.id, fieldIds, { top: 250 });

      return { result: runReport(report, table, rows) };
    } catch (error) {
      request.log.warn({
        tableId: body.table?.id || "",
        reportId: body.report?.id || "",
        fieldCount: Array.isArray(body.report?.selectedFieldIds) ? body.report?.selectedFieldIds.length : 0,
        selectedFieldIds: Array.isArray(body.report?.selectedFieldIds) ? body.report?.selectedFieldIds.slice(0, 12) : [],
        error: error instanceof Error ? error.message : error
      }, "quickbase report preview failed");
      reply.code(400);
      return {
        message: error instanceof Error ? error.message : "Quickbase report preview failed."
      };
    }
  });
}
