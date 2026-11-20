import type { RouteObject } from 'react-router';
import { t, type StringKey } from '../shared/i18n';
import { PlaceholderPage } from './pages/placeholder';

export type RouteGroup = 'auth' | 'guest-auth' | 'customer' | 'staff';

export interface Placeholder {
  /** Path relative to /app; '' is the index route. */
  path: string;
  title: StringKey;
  wave: number;
  group: RouteGroup;
}

/** Every PRD section 6b route under /app. A feature that exports the same path replaces its placeholder. */
export const placeholders: Placeholder[] = [
  { path: 'signup', title: 'page.signup', wave: 1, group: 'guest-auth' },
  { path: 'login', title: 'page.login', wave: 1, group: 'guest-auth' },
  { path: 'login/two-factor', title: 'page.twoFactor', wave: 1, group: 'auth' },
  { path: 'verify-email', title: 'page.verifyEmail', wave: 1, group: 'auth' },
  { path: 'forgot-password', title: 'page.forgotPassword', wave: 1, group: 'auth' },
  { path: 'reset-password', title: 'page.resetPassword', wave: 1, group: 'auth' },
  { path: '', title: 'page.chat', wave: 2, group: 'customer' },
  { path: 'chat', title: 'page.chat', wave: 2, group: 'customer' },
  { path: 'profile', title: 'page.profile', wave: 2, group: 'customer' },
  { path: 'plans', title: 'page.plans', wave: 2, group: 'customer' },
  { path: 'plans/new', title: 'page.newPlan', wave: 2, group: 'customer' },
  { path: 'plans/:id', title: 'page.plan', wave: 2, group: 'customer' },
  { path: 'runs/:id', title: 'page.run', wave: 4, group: 'customer' },
  { path: 'leads', title: 'page.leads', wave: 4, group: 'customer' },
  { path: 'plans/:id/leads', title: 'page.leads', wave: 4, group: 'customer' },
  { path: 'leads/:id', title: 'page.lead', wave: 4, group: 'customer' },
  { path: 'credits', title: 'page.credits', wave: 1, group: 'customer' },
  { path: 'staff', title: 'page.staffDashboard', wave: 4, group: 'staff' },
  { path: 'staff/customers', title: 'page.staffCustomers', wave: 4, group: 'staff' },
  { path: 'staff/runs', title: 'page.staffRuns', wave: 4, group: 'staff' },
  { path: 'staff/runs/:id', title: 'page.staffRun', wave: 4, group: 'staff' },
  { path: 'staff/flows', title: 'page.staffFlows', wave: 4, group: 'staff' },
  { path: 'staff/tools', title: 'page.staffTools', wave: 4, group: 'staff' },
  { path: 'staff/packs', title: 'page.staffPacks', wave: 2, group: 'staff' },
  { path: 'staff/settings', title: 'page.staffSettings', wave: 2, group: 'staff' },
  { path: 'staff/audit-log', title: 'page.staffAuditLog', wave: 2, group: 'staff' },
];

export function placeholderRoute(p: Placeholder): RouteObject {
  const element = (
    <PlaceholderPage
      title={t(p.title)}
      wave={p.wave}
      headingLevel={p.group === 'customer' || p.group === 'staff' ? 1 : 2}
    />
  );
  return p.path === '' ? { index: true, element } : { path: p.path, element };
}
