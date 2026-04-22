export function ClearableInputField({
  label,
  id,
  name,
  value,
  placeholder,
  onChange
}: {
  label: string;
  id?: string;
  name?: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field clearable-field">
      <span>{label}</span>
      <div className="clearable-input-shell">
        <input
          id={id}
          name={name}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
        {value ? (
          <button
            type="button"
            className="clearable-input-button"
            onClick={() => onChange("")}
            aria-label={`Clear ${label.toLowerCase()}`}
          >
            ×
          </button>
        ) : null}
      </div>
    </label>
  );
}
