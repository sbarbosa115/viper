import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { t } from '../shared/i18n';
import { Badge, cx, IconButton, Logo } from '../shared/ui';
import { useLogout } from './account-menu';
import { useSupportWaitingCount } from '../features/support';
import { staffNav } from './nav';
import { useIsMobile } from './use-is-mobile';

function StaffNav({ onNavigate }: { onNavigate?: () => void }) {
  const logout = useLogout();
  const link =
    'flex min-h-10 items-center rounded-sm px-3 text-sm text-muted hover:bg-surface hover:text-fg';
  return (
    <nav aria-label={t('staff.nav')} className="flex flex-1 flex-col gap-0.5">
      {staffNav.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end ?? false}
          onClick={onNavigate}
          className={({ isActive }) => cx(link, isActive && 'bg-raised text-fg')}
        >
          {t(n.label)}
          {n.badge === 'supportWaiting' && <WaitingBadge />}
        </NavLink>
      ))}
      <div className="mt-auto flex flex-col gap-0.5 border-t border-line pt-3">
        <Link to="/" onClick={onNavigate} className={link}>
          {t('staff.back')}
        </Link>
        <button
          type="button"
          className={cx(link, 'w-full text-left')}
          onClick={() => logout.mutate()}
        >
          {t('account.logout')}
        </button>
      </div>
    </nav>
  );
}

function WaitingBadge() {
  const { data: waiting } = useSupportWaitingCount();
  if (!waiting) return null;
  return (
    <span
      className="ml-auto rounded-full bg-accent px-2 font-mono text-xs text-accent-ink"
      aria-label={t('staff.supportWaiting', { count: waiting })}
    >
      {waiting}
    </span>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <Logo />
      <Badge tone="warn">{t('staff.badge')}</Badge>
    </div>
  );
}

export function StaffShell() {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (mobile) {
    return (
      <div className="min-h-screen bg-bg">
        <header className="flex h-14 items-center gap-2 border-b border-line px-2">
          <IconButton
            aria-label={open ? t('staff.closeMenu') : t('staff.menu')}
            aria-expanded={open}
            icon="menu"
            onClick={() => setOpen((v) => !v)}
          />
          <Brand />
          <WaitingBadge />
        </header>
        {open && (
          <div className="viper-fade absolute inset-x-0 top-14 z-40 flex min-h-[calc(100vh-56px)] flex-col bg-bg p-3">
            <StaffNav onNavigate={() => setOpen(false)} />
          </div>
        )}
        <main>
          <Outlet />
        </main>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen bg-bg">
      <aside className="sticky top-0 flex h-screen w-[var(--staff-nav-width)] shrink-0 flex-col gap-4 border-r border-line bg-sunken p-3">
        <div className="px-2 py-2">
          <Brand />
        </div>
        <StaffNav />
      </aside>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
