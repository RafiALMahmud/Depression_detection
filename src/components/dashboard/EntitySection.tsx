import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { ListQuery } from '../../api/services';
import type { PaginatedResponse } from '../../types/domain';
import { ConfirmationDialog } from './ConfirmationDialog';
import { DataTable } from './DataTable';
import { ModalForm } from './ModalForm';
import type { FilterConfig, FormFieldConfig, RowAction, TableColumn } from './types';

type FormValues = Record<string, string | boolean>;

const getRequestErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: string } } }).response;
    if (response?.data?.detail) return response.data.detail;
  }
  return fallback;
};

interface EntitySectionProps<T> {
  title: string;
  description: string;
  createButtonLabel?: string;
  showCreateButton?: boolean;
  columns: TableColumn<T>[];
  fields: FormFieldConfig[] | ((values: FormValues, mode: 'create' | 'edit') => FormFieldConfig[]);
  filters?: FilterConfig[];
  defaultPageSize?: number;
  reloadKey?: number;
  enableEdit?: boolean;
  enableDelete?: boolean;
  rowActions?: RowAction<T>[];
  createSuccessMessage?: string;
  updateSuccessMessage?: string;
  deleteSuccessMessage?: string;
  fetchItems: (query: ListQuery) => Promise<PaginatedResponse<T>>;
  createItem: (payload: unknown) => Promise<unknown>;
  updateItem: (id: number, payload: unknown) => Promise<unknown>;
  deleteItem: (id: number) => Promise<void>;
  getItemId: (item: T) => number;
  getDeleteLabel: (item: T) => string;
  toFormValues: (item?: T) => FormValues;
  toCreatePayload: (values: FormValues) => unknown;
  toUpdatePayload: (values: FormValues, item: T) => unknown;
  validate?: (values: FormValues, mode: 'create' | 'edit') => Record<string, string>;
  onAfterChange?: () => Promise<void> | void;
  transformValuesOnChange?: (name: string, value: string | boolean, previousValues: FormValues) => FormValues;
}

export const EntitySection = <T,>({
  title,
  description,
  createButtonLabel = 'Create New',
  showCreateButton = true,
  columns,
  fields,
  filters = [],
  defaultPageSize = 10,
  reloadKey = 0,
  enableEdit = true,
  enableDelete = true,
  rowActions = [],
  createSuccessMessage,
  updateSuccessMessage,
  deleteSuccessMessage,
  fetchItems,
  createItem,
  updateItem,
  deleteItem,
  getItemId,
  getDeleteLabel,
  toFormValues,
  toCreatePayload,
  toUpdatePayload,
  validate,
  onAfterChange,
  transformValuesOnChange,
}: EntitySectionProps<T>) => {
  const [items, setItems] = useState<T[]>([]);
  const [meta, setMeta] = useState({ page: 1, page_size: defaultPageSize, total: 0, total_pages: 1 });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadRunRef = useRef(0);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(defaultPageSize);
  const [filterState, setFilterState] = useState<Record<string, string>>(
    Object.fromEntries(filters.map((filter) => [filter.key, ''])),
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [editingItem, setEditingItem] = useState<T | null>(null);
  const [formValues, setFormValues] = useState<FormValues>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [itemToDelete, setItemToDelete] = useState<T | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const resolvedFields = useMemo(
    () => (typeof fields === 'function' ? fields(formValues, mode) : fields),
    [fields, formValues, mode],
  );

  const loadItems = useCallback(async () => {
    const runId = ++loadRunRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const query: ListQuery & Record<string, string | number> = { page, pageSize, search };
      Object.entries(filterState).forEach(([key, value]) => {
        if (!value) return;
        if (key === 'companyId' || key === 'departmentId') {
          const parsed = Number(value);
          if (Number.isNaN(parsed)) return;
          if (key === 'companyId') query.companyId = parsed;
          if (key === 'departmentId') query.departmentId = parsed;
          return;
        }
        query[key] = value;
      });
      const response = await fetchItems(query);
      if (runId !== loadRunRef.current) {
        return;
      }
      setItems(Array.isArray(response.items) ? response.items.filter((item) => item !== null && item !== undefined) : []);
      setMeta(response.meta);
    } catch (error) {
      if (runId !== loadRunRef.current) {
        return;
      }
      const message = getRequestErrorMessage(error, 'Failed to load data');
      setLoadError(message);
      toast.error(message);
      console.error(error);
    } finally {
      if (runId === loadRunRef.current) {
        setLoading(false);
      }
    }
  }, [page, pageSize, search, filterState, fetchItems, reloadKey]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const openCreate = () => {
    setMode('create');
    setEditingItem(null);
    setFormValues(toFormValues());
    setFormErrors({});
    setModalOpen(true);
  };

  const openEdit = (item: T) => {
    setMode('edit');
    setEditingItem(item);
    setFormValues(toFormValues(item));
    setFormErrors({});
    setModalOpen(true);
  };

  const submitForm = async () => {
    const errors = validate ? validate(formValues, mode) : {};
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'create') {
        await createItem(toCreatePayload(formValues));
        toast.success(createSuccessMessage || `${title} created successfully`);
      } else if (editingItem) {
        await updateItem(getItemId(editingItem), toUpdatePayload(formValues, editingItem));
        toast.success(updateSuccessMessage || `${title} updated successfully`);
      }
      setModalOpen(false);
      await loadItems();
      if (onAfterChange) {
        await onAfterChange();
      }
    } catch (error) {
      const message =
        typeof error === 'object' && error !== null && 'response' in error
          ? (error as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      toast.error(message || 'Operation failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    setIsDeleting(true);
    try {
      await deleteItem(getItemId(itemToDelete));
      toast.success(deleteSuccessMessage || `${title} deleted successfully`);
      setItemToDelete(null);
      await loadItems();
      if (onAfterChange) {
        await onAfterChange();
      }
    } catch (error) {
      const message =
        typeof error === 'object' && error !== null && 'response' in error
          ? (error as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      toast.error(message || 'Delete failed');
    } finally {
      setIsDeleting(false);
    }
  };

  const filterControls = useMemo(
    () =>
      filters.map((filter) => {
        const options = typeof filter.options === 'function' ? filter.options(filterState) : filter.options;
        const requiresKey = filter.dependsOn;
        const requiresSelected = requiresKey ? Boolean(filterState[requiresKey]) : true;
        return (
          <label key={filter.key} className="mw-field mw-filter-item">
            <span className="mw-field-label">{filter.label}</span>
            <select
              value={filterState[filter.key] ?? ''}
              onChange={(event) => {
                setFilterState((prev) => {
                  const next = { ...prev, [filter.key]: event.target.value };
                  filters.forEach((candidateFilter) => {
                    if (candidateFilter.dependsOn !== filter.key) {
                      return;
                    }
                    const candidateOptions =
                      typeof candidateFilter.options === 'function'
                        ? candidateFilter.options(next)
                        : candidateFilter.options;
                    const selectedValue = next[candidateFilter.key];
                    if (selectedValue && !candidateOptions.some((option) => option.value === selectedValue)) {
                      next[candidateFilter.key] = '';
                    }
                  });
                  return next;
                });
                setPage(1);
              }}
              className="mw-input"
              disabled={!requiresSelected}
            >
              <option value="">
                {requiresSelected
                  ? 'All'
                  : `Select ${filter.dependsOnLabel ?? requiresKey ?? 'parent'} first`}
              </option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        );
      }),
    [filters, filterState],
  );

  return (
    <section className="mw-entity-layout">
      <div className="mw-card mw-entity-header">
        <div className="mw-entity-header-row">
          <div>
            <p className="mw-entity-kicker">Management</p>
            <h2 className="mw-entity-title">{title}</h2>
            <p className="mw-entity-description">{description}</p>
          </div>
          {showCreateButton ? (
            <button type="button" onClick={openCreate} className="mw-btn-primary">
              {createButtonLabel}
            </button>
          ) : null}
        </div>

        <div className="mw-entity-controls">
          <label className="mw-field mw-entity-search">
            <span className="mw-field-label">Search</span>
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search records"
              className="mw-input"
            />
          </label>
          <div className="mw-entity-control-actions">
            <button
              type="button"
              onClick={() => {
                setPage(1);
                setSearch(searchInput.trim());
              }}
              className="mw-btn-ghost"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setSearch('');
                setPage(1);
              }}
              className="mw-btn-ghost"
            >
              Clear
            </button>
          </div>
          {filterControls.length ? <div className="mw-filter-group">{filterControls}</div> : null}
        </div>
      </div>

      {loadError ? (
        <div className="mw-card mw-empty-state">
          <h3>Section data unavailable</h3>
          <p>{loadError}</p>
          <button
            type="button"
            className="mw-btn-primary mt-4"
            onClick={() => {
              void loadItems();
            }}
          >
            Retry section load
          </button>
        </div>
      ) : null}

      {!loadError ? (
        <DataTable
          columns={columns}
          items={items}
          getRowId={getItemId}
          onEdit={enableEdit ? openEdit : undefined}
          onDelete={enableDelete ? setItemToDelete : undefined}
          rowActions={rowActions}
          loading={loading}
        />
      ) : null}

      {!loadError ? (
        <div className="mw-entity-pagination">
          <span className="mw-pagination-meta">
            Total: {meta.total} | Page {meta.page} of {meta.total_pages}
          </span>
          <div className="mw-pagination-actions">
            <button
              type="button"
              className="mw-btn-ghost"
              disabled={page <= 1 || loading}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="mw-btn-ghost"
              disabled={page >= meta.total_pages || loading}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      {meta.total === 0 && !loading && !loadError ? (
        <div className="mw-card mw-empty-state">
          <h3>No records yet</h3>
          <p>
            {showCreateButton
              ? 'Use the create button above to add your first item.'
              : 'No records match your current filters.'}
          </p>
        </div>
      ) : null}

      <ModalForm
        open={modalOpen}
        title={`${mode === 'create' ? 'Create' : 'Edit'} ${title}`}
        fields={resolvedFields}
        values={formValues}
        errors={formErrors}
        mode={mode}
        isSubmitting={isSubmitting}
        onChange={(name, value) =>
          setFormValues((prev) => {
            if (transformValuesOnChange) {
              return transformValuesOnChange(name, value, prev);
            }
            return { ...prev, [name]: value };
          })
        }
        onClose={() => setModalOpen(false)}
        onSubmit={submitForm}
      />

      <ConfirmationDialog
        open={Boolean(itemToDelete)}
        title={`Delete ${title}`}
        message={
          itemToDelete
            ? `Are you sure you want to delete ${getDeleteLabel(itemToDelete)}? This action cannot be undone.`
            : ''
        }
        isProcessing={isDeleting}
        onCancel={() => setItemToDelete(null)}
        onConfirm={confirmDelete}
      />
    </section>
  );
};
