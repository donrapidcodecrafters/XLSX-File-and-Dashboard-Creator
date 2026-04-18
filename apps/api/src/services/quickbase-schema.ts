import { XMLParser } from "fast-xml-parser";

interface QuickbaseSchemaConfig {
  realmHostname: string;
  userToken: string;
  appToken?: string;
  appId: string;
}

export interface QuickbaseFieldSchema {
  fid: string;
  label: string;
  fieldType: string;
  baseType: string;
}

export interface QuickbaseTableSchema {
  id: string;
  name: string;
  description: string;
  fields: QuickbaseFieldSchema[];
}

export interface QuickbaseAppSchema {
  id: string;
  name: string;
  description: string;
  tables: QuickbaseTableSchema[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "value",
  trimValues: true
});

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    const text = (value as Record<string, unknown>).value;
    return typeof text === "string" ? text : "";
  }
  return "";
}

async function requestSchemaXml(config: QuickbaseSchemaConfig, dbid: string) {
  const hostname = config.realmHostname.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const endpoint = `https://${hostname}/db/${encodeURIComponent(dbid)}`;
  const body = [
    "<qdbapi>",
    `<usertoken>${escapeXml(config.userToken)}</usertoken>`,
    config.appToken ? `<apptoken>${escapeXml(config.appToken)}</apptoken>` : "",
    "<udata>hosted-platform-schema</udata>",
    "</qdbapi>"
  ].join("");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/xml",
      "QUICKBASE-ACTION": "API_GetSchema"
    },
    body
  });

  const xml = await response.text();
  if (!response.ok) {
    throw new Error(`Quickbase schema request failed with status ${response.status}.`);
  }
  const parsed = parser.parse(xml) as any;
  const api = parsed?.qdbapi;
  const errcode = Number(api?.errcode ?? 0);
  if (errcode !== 0) {
    throw new Error(api?.errtext || "Quickbase returned a schema error.");
  }
  return api;
}

function parseTableSchema(api: any): QuickbaseTableSchema {
  const table = api?.table || {};
  const fields = asArray(table?.fields?.field).map((field: any) => ({
    fid: String(field?.id ?? ""),
    label: textValue(field?.label) || `Field ${String(field?.id ?? "")}`,
    fieldType: String(field?.field_type ?? ""),
    baseType: String(field?.base_type ?? "")
  }));

  return {
    id: textValue(table?.original?.table_id) || "",
    name: textValue(table?.name) || "Unnamed table",
    description: textValue(table?.desc) || "",
    fields
  };
}

export async function loadQuickbaseSchema(config: QuickbaseSchemaConfig): Promise<QuickbaseAppSchema> {
  if (!config.realmHostname || !config.userToken || !config.appId) {
    throw new Error("Realm hostname, user token, and app ID are required.");
  }

  const appApi = await requestSchemaXml(config, config.appId);
  const appTable = appApi?.table || {};
  const childDbids = asArray(appTable?.chdbids?.chdbid)
    .map((item: any) => textValue(item))
    .filter(Boolean);

  const tableSchemas = childDbids.length
    ? await Promise.all(
        childDbids.map(async (tableId) => parseTableSchema(await requestSchemaXml(config, tableId)))
      )
    : [parseTableSchema(appApi)].filter((table) => table.id && table.fields.length);

  return {
    id: textValue(appTable?.original?.app_id) || config.appId,
    name: textValue(appTable?.name) || "Quickbase app",
    description: textValue(appTable?.desc) || "",
    tables: tableSchemas
      .filter((table) => table.id)
      .sort((left, right) => left.name.localeCompare(right.name))
  };
}
