import type { DashboardDefinition, ReportDefinition } from "@studio/shared";

function safeFileName(name: string, fallback: string) {
  const next = (name || fallback).replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return next || fallback;
}

function buildFileTimestamp(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

export function buildReportFileName(report: ReportDefinition) {
  return `${safeFileName(report.name, report.id)} ${buildFileTimestamp(new Date())}.xlsx`;
}

export function buildDashboardFileName(dashboard: DashboardDefinition) {
  return `${safeFileName(dashboard.name, dashboard.id)} ${buildFileTimestamp(new Date())}.xlsx`;
}
