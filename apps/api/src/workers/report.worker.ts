import { parentPort, workerData } from "node:worker_threads";
import { runReport, type FilterDefinition, type ReportDefinition } from "@studio/shared";
import { objectStore } from "../services/object-store.js";

interface WorkerInput {
  report: ReportDefinition;
  extraFilters: FilterDefinition[];
}

const input = workerData as WorkerInput;
const table = objectStore.getTable(input.report.sourceTableId);

if (!parentPort) {
  throw new Error("Worker port unavailable.");
}

if (!table) {
  throw new Error("Table not found for report " + input.report.id + ".");
}

const rows = objectStore.getRows(table.id);
const result = runReport(input.report, table, rows, input.extraFilters);
parentPort.postMessage(result);
