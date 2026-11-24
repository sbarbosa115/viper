import { categoryLabels, staffStatusLabel, type StaffTicketSummary } from '@app/contracts/support';
import { Link } from 'react-router';
import { Badge, Table, type Column } from '../../../../shared/ui';
import { copy } from '../copy';
import { formatWait } from '../lib/format';

interface ListProps {
  rows: StaffTicketSummary[];
  meId: string | undefined;
  emptyTitle: string;
  emptyDescription?: string;
}

const href = (t: StaffTicketSummary) => `/staff/support/${t.number}`;

function assigneeText(t: StaffTicketSummary, meId: string | undefined): string | null {
  if (!t.assignee) return null;
  return t.assignee.id === meId ? copy.you : t.assignee.name;
}

function NewReply() {
  return (
    <span className="font-mono text-xs text-accent">
      <span aria-hidden="true">● </span>
      {copy.newReply}
    </span>
  );
}

/** FR-6 on desktop: the Support desk table. */
export function DeskTable({ rows, meId, emptyTitle, emptyDescription }: ListProps) {
  const columns: Column<StaffTicketSummary>[] = [
    {
      key: 'number',
      header: copy.colNumber,
      cell: (t) => <span className="font-mono">{t.number}</span>,
    },
    {
      key: 'subject',
      header: copy.colSubject,
      cell: (t) => (
        <span className="flex flex-col gap-1">
          <Link to={href(t)} className="font-medium text-fg hover:underline">
            {t.subject}
          </Link>
          {t.unreadCustomerReply && <NewReply />}
        </span>
      ),
    },
    {
      key: 'business',
      header: copy.colBusiness,
      cell: (t) => `${t.business.name} · ${t.openedBy.name}`,
    },
    { key: 'category', header: copy.colCategory, cell: (t) => categoryLabels[t.category] },
    {
      key: 'status',
      header: copy.colStatus,
      cell: (t) => <Badge>{staffStatusLabel(t.status)}</Badge>,
    },
    {
      key: 'assignee',
      header: copy.colAssignee,
      cell: (t) => assigneeText(t, meId) ?? <span className="text-faint">{copy.nobody}</span>,
    },
    {
      key: 'waiting',
      header: copy.colWaiting,
      numeric: true,
      cell: (t) => formatWait(t.waitMinutes),
    },
  ];
  return (
    <Table
      caption={copy.caption}
      columns={columns}
      rows={rows}
      rowKey={(t) => String(t.number)}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
    />
  );
}

/** FR-6 on mobile: one card per ticket. */
export function DeskCards({ rows, meId }: Pick<ListProps, 'rows' | 'meId'>) {
  return (
    <ul
      aria-label={copy.caption}
      className="m-0 list-none overflow-hidden rounded-card border border-line-strong p-0"
    >
      {rows.map((t) => {
        const who = assigneeText(t, meId);
        return (
          <li key={t.number} className="border-b border-line last:border-b-0">
            <Link to={href(t)} className="flex flex-col gap-1.5 px-4 py-3.5 text-fg no-underline">
              <span className="flex items-center justify-between gap-2 font-mono text-xs text-muted">
                <span>
                  #{t.number} · {categoryLabels[t.category]}
                </span>
                <span>
                  {staffStatusLabel(t.status)} · {formatWait(t.waitMinutes)}
                </span>
              </span>
              <span className="text-[15px] font-medium">{t.subject}</span>
              <span className="text-[13px] text-muted">
                {t.business.name} · {t.openedBy.name}
                {t.unreadCustomerReply && (
                  <>
                    {' · '}
                    <NewReply />
                  </>
                )}
                {' · '}
                {who ?? copy.nobodyAssigned}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
