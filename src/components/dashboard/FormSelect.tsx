import type { SelectOption } from './types';

interface FormSelectProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
}

export const FormSelect = ({
  id,
  label,
  value,
  onChange,
  options,
  required = false,
  placeholder = 'Select an option',
  disabled = false,
  error,
}: FormSelectProps) => {
  return (
    <label htmlFor={id} className="mw-field">
      <span className="mw-field-label">
        {label}
        {required ? ' *' : ''}
      </span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mw-input"
        disabled={disabled}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? <span className="mw-field-error">{error}</span> : null}
    </label>
  );
};
