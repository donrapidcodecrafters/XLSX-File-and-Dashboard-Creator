import { useMemo, useRef, useState, type ReactNode } from "react";

type ResizableColumn = {
  key: string;
  label: ReactNode;
  minWidth?: number;
  defaultWidth?: number;
  className?: string;
};

interface ResizableDataTableProps {
  className?: string;
  columns: ResizableColumn[];
  rows: Array<{
    key: string;
    cells: ReactNode[];
  }>;
}

const DEFAULT_MIN_WIDTH = 140;

export function ResizableDataTable({ className = "", columns, rows }: ResizableDataTableProps) {
  const [widths, setWidths] = useState<number[]>(() =>
    columns.map((column) => Math.max(column.defaultWidth ?? column.minWidth ?? DEFAULT_MIN_WIDTH, column.minWidth ?? DEFAULT_MIN_WIDTH))
  );
  const dragStateRef = useRef<{
    columnIndex: number;
    startX: number;
    startWidth: number;
    minWidth: number;
  } | null>(null);

  const normalizedWidths = useMemo(
    () =>
      columns.map((column, index) =>
        Math.max(widths[index] ?? column.defaultWidth ?? column.minWidth ?? DEFAULT_MIN_WIDTH, column.minWidth ?? DEFAULT_MIN_WIDTH)
      ),
    [columns, widths]
  );

  function beginResize(event: React.PointerEvent<HTMLButtonElement>, columnIndex: number) {
    event.preventDefault();
    event.stopPropagation();
    const column = columns[columnIndex];
    dragStateRef.current = {
      columnIndex,
      startX: event.clientX,
      startWidth: normalizedWidths[columnIndex] ?? column.defaultWidth ?? column.minWidth ?? DEFAULT_MIN_WIDTH,
      minWidth: column.minWidth ?? DEFAULT_MIN_WIDTH
    };

    function handlePointerMove(moveEvent: PointerEvent) {
      const dragState = dragStateRef.current;
      if (!dragState) return;
      const nextWidth = Math.max(dragState.minWidth, Math.round(dragState.startWidth + (moveEvent.clientX - dragState.startX)));
      setWidths((current) => {
        const next = [...current];
        next[dragState.columnIndex] = nextWidth;
        return next;
      });
    }

    function handlePointerUp() {
      dragStateRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  return (
    <div className={`table-shell ${className}`.trim()}>
      <table className="resizable-data-table">
        <colgroup>
          {normalizedWidths.map((width, index) => (
            <col key={columns[index]?.key || index} style={{ width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={column.key} className={column.className}>
                <div className="resizable-th-content">
                  <span>{column.label}</span>
                  <button
                    type="button"
                    className="column-resize-handle"
                    aria-label={`Resize ${typeof column.label === "string" ? column.label : "column"}`}
                    onPointerDown={(event) => beginResize(event, index)}
                  />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {row.cells.map((cell, index) => (
                <td key={`${row.key}-${columns[index]?.key || index}`} className={columns[index]?.className}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
