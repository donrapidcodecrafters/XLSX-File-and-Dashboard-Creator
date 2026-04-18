import { parentPort, workerData } from "node:worker_threads";
import { runReport, type DataRow, type FilterDefinition, type ReportDefinition, type TableDefinition } from "@studio/shared";

interface WorkerInput {
  report: ReportDefinition;
  table: TableDefinition;
  rows: DataRow[];
  extraFilters: FilterDefinition[];
}

const input = workerData as WorkerInput;

if (!parentPort) {
  throw new Error("Worker port unavailable.");
}

const result = runReport(input.report, input.table, input.rows, input.extraFilters);
parentPort.postMessage(result);
