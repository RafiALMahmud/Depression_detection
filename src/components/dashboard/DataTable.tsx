import type { ReactNode } from 'react';

import type { TableColumn } from './types';
import type { RowAction } from './types';

interface DataTableProps<T> {
  columns: TableColumn<T>[];
  items: T[];
  getRowId: (item: T) => number | string;
  onEdit?: (item: T) => void;
  onDelete?: (item: T) => void;
  rowActions?: RowAction<T>[];
  loading?: boolean;
  emptyMessage?: string;
}

export const DataTable = <T,>({
  columns,
  items,
  getRowId,
  onEdit,
  onDelete,
  rowActions = [],
  loading = false,
  emptyMessage = 'No records found.',
}: DataTableProps<T>) => {
  const hasActions = Boolean(onEdit || onDelete || rowActions.length);

  const safeGetRowId = (item: T, index: number): number | string => {
    try {
      const id = getRowId(item);
      if (id === null || id === undefined || id === '') {
        return `row-${index}`;
      }
      return id;
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('[MindWell][DataTable] Failed to resolve row id', error, item);
      }
      return `row-${index}`;
    }
  };

  const safeRenderCell = (renderer: (item: T) => ReactNode, item: T, columnKey: string): ReactNode => {
    try {
      return renderer(item);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('[MindWell][DataTable] Cell renderer failed', { columnKey, item, error });
      }
      return <span className="mw-helper-text">Unavailable</span>;
    }
  };

  const safeResolveHidden = (predicate: ((item: T) => boolean) | undefined, item: T): boolean => {
    if (!predicate) return false;
    try {
      return predicate(item);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('[MindWell][DataTable] Row action visibility check failed', { item, error });
      }
      return true;
    }
  };

  return (
    <div className="mw-data-table-shell">
      <div className="mw-data-table-scroll">
        <table className="mw-data-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>
                  {column.title}
                </th>
              ))}
              {hasActions && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length + (hasActions ? 1 : 0)} className="mw-table-state">
                  Loading...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (hasActions ? 1 : 0)} className="mw-table-state">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              items.map((item, index) => {
                const rowId = safeGetRowId(item, index);
                return (
                <tr key={rowId} className="mw-data-row">
                  {columns.map((column) => (
                    <td key={`${rowId}-${column.key}`} className={column.className}>
                      {safeRenderCell(column.render, item, column.key)}
                    </td>
                  ))}
                  {hasActions && (
                    <td>
                      <div className="mw-table-actions">
                        {rowActions
                          .filter((action) => !safeResolveHidden(action.hidden, item))
                          .map((action) => {
                            const styleClass =
                              action.variant === 'danger'
                                ? 'mw-chip-danger'
                                : action.variant === 'success'
                                  ? 'mw-chip-success'
                                  : '';
                            return (
                              <button
                                key={`${rowId}-${action.key}`}
                                type="button"
                                onClick={() => action.onClick(item)}
                                className={`mw-btn-chip ${styleClass}`.trim()}
                              >
                                {action.label}
                              </button>
                            );
                          })}
                        {onEdit && (
                          <button
                            type="button"
                            onClick={() => onEdit(item)}
                            className="mw-btn-chip"
                          >
                            Edit
                          </button>
                        )}
                        {onDelete && (
                          <button
                            type="button"
                            onClick={() => onDelete(item)}
                            className="mw-btn-chip mw-chip-danger"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              )})
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
