import type { StringKey } from '../shared/i18n';
import type { IconName } from '../shared/ui';

export type Section = 'chat' | 'plans' | 'leads' | 'credits';

export interface CustomerNavItem {
  section: Section;
  to: string;
  label: StringKey;
  icon: IconName;
}

export const customerNav: CustomerNavItem[] = [
  { section: 'chat', to: '/chat', label: 'nav.chat', icon: 'chat' },
  { section: 'plans', to: '/plans', label: 'nav.plans', icon: 'plans' },
  { section: 'leads', to: '/leads', label: 'nav.leads', icon: 'leads' },
  { section: 'credits', to: '/credits', label: 'nav.credits', icon: 'credits' },
];

/** Which rail item is current for a path (relative to /app). */
export function activeSection(pathname: string): Section | null {
  if (pathname === '/' || pathname.startsWith('/chat')) return 'chat';
  if (pathname.startsWith('/leads') || /^\/plans\/[^/]+\/leads/.test(pathname)) return 'leads';
  if (pathname.startsWith('/plans') || pathname.startsWith('/runs')) return 'plans';
  if (pathname.startsWith('/credits')) return 'credits';
  return null;
}

export interface StaffNavItem {
  to: string;
  label: StringKey;
  end?: boolean;
}

export const staffNav: StaffNavItem[] = [
  { to: '/staff', label: 'staff.dashboard', end: true },
  { to: '/staff/customers', label: 'staff.customers' },
  { to: '/staff/runs', label: 'staff.runs' },
  { to: '/staff/flows', label: 'staff.flows' },
  { to: '/staff/tools', label: 'staff.tools' },
  { to: '/staff/packs', label: 'staff.packs' },
  { to: '/staff/settings', label: 'staff.settings' },
  { to: '/staff/audit-log', label: 'staff.auditLog' },
];

const sectionLabels: Record<string, StringKey> = {
  chat: 'page.chat',
  profile: 'page.profile',
  plans: 'page.plans',
  runs: 'page.run',
  leads: 'page.leads',
  credits: 'page.credits',
};

/** Breadcrumb labels after the Business name, from the path. */
export function breadcrumbKeys(pathname: string): StringKey[] {
  const [first, second, third] = pathname.split('/').filter(Boolean);
  if (!first) return ['page.chat'];
  const section = sectionLabels[first];
  if (!section) return [];
  const keys: StringKey[] = [section];
  if (first === 'plans' && second === 'new') keys.push('page.newPlan');
  else if (first === 'plans' && second) keys.push(third === 'leads' ? 'page.leads' : 'page.plan');
  else if (first === 'leads' && second) keys.push('page.lead');
  return keys;
}
