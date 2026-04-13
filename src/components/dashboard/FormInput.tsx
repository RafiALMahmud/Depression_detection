interface FormInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'password';
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  error?: string;
}

export const FormInput = ({
  id,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required = false,
  disabled = false,
  error,
}: FormInputProps) => {
  return (
    <label htmlFor={id} className="mw-field">
      <span className="mw-field-label">
        {label}
        {required ? ' *' : ''}
      </span>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mw-input"
        disabled={disabled}
      />
      {error ? <span className="mw-field-error">{error}</span> : null}
    </label>
  );
};
