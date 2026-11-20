import { getDashboard, type Dashboard } from '@app/contracts/reporting';
import { startActingAs } from '@app/contracts/identity';
import { dashboard as example, me as meExample, ids } from '@app/contracts/examples';
import { http, HttpResponse } from 'msw';

export const dashboardState: {
  data: Dashboard;
  periods: string[];
  actedAs: string[];
} = { data: example, periods: [], actedAs: [] };

export function resetDashboardState() {
  dashboardState.data = example;
  dashboardState.periods = [];
  dashboardState.actedAs = [];
}

export const handlers = [
  http.get('*/api/staff/dashboard', ({ request }) => {
    const period = getDashboard.query.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    ).period;
    dashboardState.periods.push(period);
    return HttpResponse.json(getDashboard.response.parse({ ...dashboardState.data, period }));
  }),

  http.post('*/api/staff/acting-as', async ({ request }) => {
    const body = startActingAs.body.parse(await request.json());
    dashboardState.actedAs.push(body.businessId);
    return HttpResponse.json(
      startActingAs.response.parse({
        ...meExample,
        member: { ...meExample.member, isStaff: true },
        actingAs: { businessId: body.businessId, businessName: 'Sweet Supply Co' },
        business: { id: ids.business, name: 'Llyner' },
      }),
    );
  }),
];
