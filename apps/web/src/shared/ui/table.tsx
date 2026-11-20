import type { ReactNode } from 'react';
import { t } from '../i18n';
import { cx } from './cx';
import { EmptyState } from './feedback';
import { Icon } from './icon';

export interface Column<Row> {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  sortable?: boolean;
  /** Numbers are right-aligned and set in mono. */
  numeric?: boolean;
}

export interface SortState {
  key: string;
  direction: 'asc' | 'desc';
}

export interface TableProps<Row> {
  caption: string;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  sort?: SortState | null;
  onSortChange?: (sort: SortState) => void;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
}

export function Table<Row>({
  caption,
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  emptyTitle = t('common.noRows'),
  emptyDescription,
}: TableProps<Row>) {
  if (rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className="max-w-full overflow-x-auto rounded-card border border-line-strong"
    >
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line">
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={
                    active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                  className={cx(
                    'px-4 py-3 text-xs font-medium text-muted',
                    c.numeric && 'text-right',
                  )}
                >
                  {c.sortable && onSortChange ? (
                    <button
                      type="button"
                      aria-label={t('common.sortBy', { column: c.header })}
                      onClick={() =>
                        onSortChange({
                          key: c.key,
                          direction: active && sort.direction === 'asc' ? 'desc' : 'asc',
                        })
                      }
                      className="inline-flex items-center gap-1 hover:text-fg"
                    >
                      {c.header}
                      <Icon name="sort" size={12} />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-line last:border-b-0">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cx('px-4 py-3.5 text-fg-2', c.numeric && 'text-right font-mono')}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
