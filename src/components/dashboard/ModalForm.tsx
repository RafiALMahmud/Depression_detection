import { FormInput } from './FormInput';
import { FormSelect } from './FormSelect';
import type { FormFieldConfig } from './types';

interface ModalFormProps {
  open: boolean;
  title: string;
  subtitle?: string;
  fields: FormFieldConfig[];
  values: Record<string, string | boolean>;
  errors: Record<string, string>;
  mode: 'create' | 'edit';
  isSubmitting: boolean;
  onChange: (name: string, value: string | boolean) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export const ModalForm = ({
  open,
  title,
  subtitle,
  fields,
  values,
  errors,
  mode,
  isSubmitting,
  onChange,
  onClose,
  onSubmit,
}: ModalFormProps) => {
  if (!open) {
    return null;
  }

  return (
    <div className="mw-modal-overlay">
      <div className="mw-modal-card">
        <div className="mw-modal-header">
          <div>
            <h3 className="mw-modal-title">{title}</h3>
            {subtitle ? <p className="mw-modal-subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="mw-modal-close">
            Close
          </button>
        </div>

        <form
          className="mw-modal-form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {fields.map((field) => {
            if (mode === 'create' && field.hiddenOnCreate) {
              return null;
            }
            if (mode === 'edit' && field.hiddenOnEdit) {
              return null;
            }
            const value = values[field.name];
            const error = errors[field.name];
            const commonProps = {
              id: field.name,
              label: field.label,
              required: field.required,
              error,
            };

            if (field.type === 'select') {
              return (
                <div key={field.name}>
                  <FormSelect
                    {...commonProps}
                    value={String(value ?? '')}
                    options={field.options ?? []}
                    onChange={(nextValue) => onChange(field.name, nextValue)}
                  />
                </div>
              );
            }

            if (field.type === 'textarea') {
              return (
                <label key={field.name} htmlFor={field.name} className="mw-field mw-col-span-2">
                  <span className="mw-field-label">
                    {field.label}
                    {field.required ? ' *' : ''}
                  </span>
                  <textarea
                    id={field.name}
                    value={String(value ?? '')}
                    placeholder={field.placeholder}
                    onChange={(event) => onChange(field.name, event.target.value)}
                    className="mw-input mw-textarea"
                  />
                  {error ? <span className="mw-field-error">{error}</span> : null}
                </label>
              );
            }

            if (field.type === 'checkbox') {
              return (
                <label key={field.name} className="mw-checkbox-field mw-col-span-2">
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(event) => onChange(field.name, event.target.checked)}
                  />
                  <span>{field.label}</span>
                </label>
              );
            }

            return (
              <div key={field.name}>
                <FormInput
                  {...commonProps}
                  type={field.type === 'email' ? 'email' : field.type === 'password' ? 'password' : 'text'}
                  value={String(value ?? '')}
                  placeholder={field.placeholder}
                  onChange={(nextValue) => onChange(field.name, nextValue)}
                />
              </div>
            );
          })}

          <div className="mw-modal-actions">
            <button type="button" onClick={onClose} className="mw-btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="mw-btn-primary">
              {isSubmitting ? 'Saving...' : mode === 'create' ? 'Create' : 'Update'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
