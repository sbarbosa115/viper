import { errorResponse } from '@app/contracts/errors';
import { auditLogEntry as entryExample } from '@app/contracts/examples';
import { listAuditLog, type AuditLogEntry } from '@app/contracts/platform';
import { http, HttpResponse } from 'msw';

export const auditState: {
  entries: AuditLogEntry[];
  /** Query strings of every request, to assert the filters sent. */
  requests: URLSearchParams[];
  fail: boolean;
} = { entries: [], requests: [], fail: false };

export function resetAuditState() {
  auditState.entries = [entryExample];
  auditState.requests = [];
  auditState.fail = false;
}
resetAuditState();

export const handlers = [
  http.get('*/api/staff/audit-log', ({ request }) => {
    const q = new URL(request.url).searchParams;
    auditState.requests.push(q);
    if (auditState.fail) {
      return HttpResponse.json(
        errorResponse.parse({ error: { code: 'INTERNAL', message: 'Boom' } }),
        { status: 500 },
      );
    }
    const query = listAuditLog.query.parse(Object.fromEntries(q));
    const matching = auditState.entries.filter(
      (e) =>
        (!query.businessId || e.business?.id === query.businessId) &&
        (!query.staffMemberId || e.staff.id === query.staffMemberId) &&
        (!query.action || e.action === query.action),
    );
    const start = Number(query.cursor ?? 0);
    const end = start + query.limit;
    return HttpResponse.json(
      listAuditLog.response.parse({
        items: matching.slice(start, end),
        nextCursor: end < matching.length ? String(end) : null,
      }),
    );
  }),
];
