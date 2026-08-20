import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkbookUploadModal } from "./WorkbookUploadModal";

// Regression test for a bug where selecting an existing workbook (whose saved
// header row differs from what the file's raw auto-detection finds) left BOTH
// the wrong auto-detected header buttons AND the correct reconciled ones in the
// DOM simultaneously. Root cause: the key-field picker used `key={h}` (the header
// label text) — when auto-detection misreads a merged title row, every column
// gets the SAME repeated label, so React sees many children sharing one key. On
// the follow-up re-peek at the correct row, React's reconciler has no valid
// identity mapping between a same-key list and a uniquely-keyed one and can leave
// stale nodes behind instead of cleanly replacing them. Fixed by keying on index
// + label instead of label alone.
vi.mock("../lib/studioApi", () => {
  const CORRECT_HEADERS = [
    "Billed Date", "Patient Name", "MRN", "Claim Number", "Claim Status",
    "Billing Period Start Date", "Billing Period End Date", "TOB", "Insurance",
    "Payer Type", "Agency", "Branch", "Last Follow-up", "Last Follow-up User",
    "Medicare / Subscriber Number", "Anticipated Payment"
  ];
  const WRONG_HEADERS = Array.from({ length: 26 }, () => "Billed Claims Report Export: 03/16/2026");

  return {
    fetchStudioSources: vi.fn().mockResolvedValue({
      sources: [{ sourceId: "xlsx:test-billed-claims", sourceName: "Test Billed Claims", sourceType: "xlsx", rowCount: 15399, fieldCount: 16, updatedAt: null }]
    }),
    fetchSourceFields: vi.fn().mockResolvedValue({
      sourceId: "xlsx:test-billed-claims",
      fields: CORRECT_HEADERS.map((label, i) => ({ id: `f${i}`, label, type: "text" })),
      keyFieldIds: [],
      headerSkipRows: 2
    }),
    getWorkbookProfile: vi.fn().mockResolvedValue({ profile: null }),
    // Mirrors the real peek endpoint: without a header-row override, a merged
    // title row spanning every column auto-detects as the header (repeated
    // label per column); with the saved override applied, it correctly resolves
    // to the real column labels.
    peekXlsxFile: vi.fn().mockImplementation((_file, options) => {
      const usingCorrect = options?.headerRowOverrides?.["Billed Claims"] === 3;
      const headers = usingCorrect ? CORRECT_HEADERS : WRONG_HEADERS;
      return Promise.resolve({
        filename: "billed-claims.xlsx",
        sheetNames: ["Billed Claims"],
        sheets: [{
          name: "Billed Claims", rowCount: usingCorrect ? 15399 : 15401,
          columnCount: headers.length, headers, looksLikeData: true,
          detectedHeaderRow: usingCorrect ? 3 : 1
        }],
        headers,
        rows: [],
        rowCount: usingCorrect ? 15399 : 15401,
        headerDiff: null, existingKeyFieldIds: [], existingHeaderSkipRows: usingCorrect ? 2 : 0
      });
    }),
    importStudioWorkbook: vi.fn(),
    importStudioWorkbookSource: vi.fn(),
    saveWorkbookProfile: vi.fn().mockResolvedValue({ ok: true })
  };
});

describe("WorkbookUploadModal", () => {
  it("reconciles to the existing target's saved header row without leaving stale wrong-row buttons", async () => {
    render(<WorkbookUploadModal open={true} onClose={() => {}} onSuccess={() => {}} />);

    await waitFor(() => expect(screen.getByText(/Select workbook/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Select workbook/i));
    await waitFor(() => expect(screen.getByText(/Test Billed Claims/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Test Billed Claims/i));

    const file = new File(["dummy"], "billed-claims.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("Billed Date")).toBeInTheDocument());
    // Let the reconciliation effect's async re-peek fully settle.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(screen.queryAllByText("Billed Claims Report Export: 03/16/2026")).toHaveLength(0);
    expect(screen.getByText("Billed Date")).toBeInTheDocument();
    expect(screen.getByText("Anticipated Payment")).toBeInTheDocument();
  });
});
