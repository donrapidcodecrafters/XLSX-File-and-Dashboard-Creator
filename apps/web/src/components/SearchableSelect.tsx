import { useEffect, useMemo, useRef, useState } from "react";

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
      {open ? (
        <div className="searchable-select-menu">
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
        </div>
      ) : null}
    </div>
  );
}
