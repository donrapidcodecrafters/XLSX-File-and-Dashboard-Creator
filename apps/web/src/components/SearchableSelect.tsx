import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface SearchableSelectOption {
  value: string;
  label: string;
  keywords?: string[];
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().trim();
}

export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = "Search…",
  emptyLabel = "No matches found.",
  allowEmpty = false,
  emptyOptionLabel = "None"
}: {
  value: string;
  options: SearchableSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  allowEmpty?: boolean;
  emptyOptionLabel?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) || null,
    [options, value]
  );

  useEffect(() => {
    setQuery(selectedOption?.label || "");
  }, [selectedOption?.label]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery(selectedOption?.label || "");
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [selectedOption?.label]);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return options;
    return options.filter((option) => {
      const haystacks = [
        option.label,
        option.value,
        ...(option.keywords || [])
      ].map(normalizeSearchText);
      return haystacks.some((entry) => entry.includes(normalizedQuery));
    });
  }, [options, query]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuRect(null);
      return;
    }
    function updateMenuRect() {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportHeight = window.innerHeight || 0;
      const top = rect.bottom + 6;
      const availableHeight = Math.max(160, viewportHeight - top - 16);
      setMenuRect({
        top,
        left: rect.left,
        width: rect.width,
        maxHeight: Math.min(320, availableHeight)
      });
    }
    updateMenuRect();
    window.addEventListener("resize", updateMenuRect);
    window.addEventListener("scroll", updateMenuRect, true);
    return () => {
      window.removeEventListener("resize", updateMenuRect);
      window.removeEventListener("scroll", updateMenuRect, true);
    };
  }, [open]);

  const menu = open && menuRect ? createPortal(
    <div
      className="searchable-select-menu"
      style={{
        position: "fixed",
        top: `${menuRect.top}px`,
        left: `${menuRect.left}px`,
        width: `${menuRect.width}px`,
        maxHeight: `${menuRect.maxHeight}px`
      }}
    >
      {allowEmpty ? (
        <button
          type="button"
          className={`searchable-select-option${value === "" ? " active" : ""}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange("");
            setOpen(false);
            setQuery("");
          }}
        >
          {emptyOptionLabel}
        </button>
      ) : null}
      {filteredOptions.length ? filteredOptions.map((option) => (
        <button
          type="button"
          key={option.value}
          className={`searchable-select-option${option.value === value ? " active" : ""}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange(option.value);
            setOpen(false);
            setQuery(option.label);
          }}
        >
          {option.label}
        </button>
      )) : <div className="searchable-select-empty">{emptyLabel}</div>}
    </div>,
    document.body
  ) : null;

  return (
    <div className={`searchable-select${open ? " is-open" : ""}`} ref={rootRef}>
      <input
        className="searchable-select-input"
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            setQuery(selectedOption?.label || "");
          }
        }}
      />
      {menu}
    </div>
  );
}
