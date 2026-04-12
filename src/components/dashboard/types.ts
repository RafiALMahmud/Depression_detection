import type { ReactNode } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

export type FieldType = 'text' | 'email' | 'password' | 'textarea' | 'select' | 'checkbox';

export interface FormFieldConfig {
  name: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  options?: SelectOption[];
  hiddenOnEdit?: boolean;
  hiddenOnCreate?: boolean;
}

export interface FilterConfig {
  key: string;
  label: string;
  options: SelectOption[] | ((filterState: Record<string, string>) => SelectOption[]);
  dependsOn?: string;
  dependsOnLabel?: string;
}

export interface TableColumn<T> {
  key: string;
  title: string;
  render: (item: T) => ReactNode;
  className?: string;
}

export interface RowAction<T> {
  key: string;
  label: string;
  onClick: (item: T) => void;
  variant?: 'default' | 'danger' | 'success';
  hidden?: (item: T) => boolean;
}
