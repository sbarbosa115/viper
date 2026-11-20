import { Link, Outlet, useLocation } from 'react-router';
import type { Me } from '@app/contracts/identity';
import { t } from '../shared/i18n';
import { Banner, cx, Icon, KeyboardHint, Logo } from '../shared/ui';
import { AccountMenu } from './account-menu';
import { activeSection, breadcrumbKeys, customerNav } from './nav';
import { useCreditBalance, useMe } from './me';
import { useIsMobile } from './use-is-mobile';

function CreditPill({ balance, className }: { balance: number | null; className?: string }) {
  const text = t('header.creditsUnit', { count: balance ?? '—' });
  return (
    <Link
      to="/credits"
      aria-label={t('header.credits', { count: balance ?? '—' })}
      className={cx(
        'inline-flex h-9 items-center rounded-full border border-line-control bg-surface px-3.5 font-mono text-[13px] text-fg hover:bg-raised',
        className,
      )}
    >
      {text}
    </Link>
  );
}

function Rail({ me }: { me: Me }) {
  const { pathname } = useLocation();
  const current = activeSection(pathname);
  const showStaff = me.member.isStaff && me.twoFactor.passed;
  const item =
    'grid size-11 place-items-center rounded-control text-muted hover:bg-surface hover:text-fg';
  return (
    <nav
      aria-label={t('nav.primary')}
      className="sticky top-0 flex h-screen w-[var(--rail-width)] shrink-0 flex-col items-center gap-2 border-r border-line bg-bg py-3"
    >
      <a href="/" aria-label={t('nav.home')} title={t('nav.home')} className="mb-3 rounded-sm">
        <Logo markOnly />
      </a>
      {customerNav.map((n) => (
        <Link
          key={n.section}
          to={n.to}
          aria-label={t(n.label)}
          title={t(n.label)}
          aria-current={current === n.section ? 'page' : undefined}
          className={cx(item, current === n.section && 'bg-raised text-fg')}
        >
          <Icon name={n.icon} />
        </Link>
      ))}
      {showStaff && (
        <Link
          to="/staff"
          aria-label={t('nav.staff')}
          title={t('nav.staff')}
          className={cx(item, 'mt-auto')}
        >
          <Icon name="staff" />
        </Link>
      )}
    </nav>
  );
}

function Breadcrumb({ business }: { business: string }) {
  const { pathname } = useLocation();
  const crumbs = [business, ...breadcrumbKeys(pathname).map((k) => t(k))];
  return (
    <nav aria-label={t('header.breadcrumb')} className="min-w-0 truncate text-sm text-muted">
      <ol className="m-0 flex list-none items-center gap-1.5 p-0">
        {crumbs.map((c, i) => (
          <li key={`${c}-${i}`} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <span aria-hidden="true">/</span>}
            <span
              className={cx('truncate', i === crumbs.length - 1 && 'text-fg')}
              aria-current={i === crumbs.length - 1 ? 'page' : undefined}
            >
              {c}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Header({ me, balance }: { me: Me; balance: number | null }) {
  const business = me.actingAs?.businessName ?? me.business.name;
  return (
    <header className="flex h-[var(--header-height)] shrink-0 items-center justify-between gap-4 border-b border-line px-[var(--page-gutter)]">
      <Breadcrumb business={business} />
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled
          aria-label={t('header.searchLabel')}
          className="hidden h-9 w-72 items-center justify-between rounded-control border border-line-control bg-surface px-3 text-sm text-faint lg:flex"
        >
          <span className="flex items-center gap-2">
            <Icon name="search" size={16} />
            {t('header.search')}
          </span>
          <KeyboardHint>⌘K</KeyboardHint>
        </button>
        <CreditPill balance={balance} />
        <AccountMenu me={me} />
      </div>
    </header>
  );
}

function MobileTopBar({ me, balance }: { me: Me; balance: number | null }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
      <a href="/" aria-label={t('nav.home')}>
        <Logo />
      </a>
      <div className="flex items-center gap-2">
        <CreditPill balance={balance} />
        <AccountMenu me={me} />
      </div>
    </header>
  );
}

function TabBar() {
  const { pathname } = useLocation();
  const current = activeSection(pathname);
  return (
    <nav
      aria-label={t('nav.mobile')}
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-bg pb-[env(safe-area-inset-bottom)]"
    >
      {customerNav.map((n) => (
        <Link
          key={n.section}
          to={n.to}
          aria-current={current === n.section ? 'page' : undefined}
          className={cx(
            'flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs',
            current === n.section ? 'text-accent' : 'text-muted',
          )}
        >
          <Icon name={n.icon} />
          {t(n.label)}
        </Link>
      ))}
    </nav>
  );
}

export function CustomerShell() {
  const { me } = useMe();
  const mobile = useIsMobile();
  const balance = useCreditBalance(me !== null);
  if (!me) return null;
  return (
    <div className="flex min-h-screen bg-bg">
      {!mobile && <Rail me={me} />}
      <div className="flex min-w-0 flex-1 flex-col">
        {mobile ? <MobileTopBar me={me} balance={balance} /> : <Header me={me} balance={balance} />}
        {me.actingAs && (
          <div className="px-4 pt-3 md:px-[var(--page-gutter)]">
            <Banner tone="warn">
              {t('acting.banner', { business: me.actingAs.businessName })}
            </Banner>
          </div>
        )}
        <main className={cx('min-w-0 flex-1', mobile && 'pb-20')}>
          <Outlet />
        </main>
      </div>
      {mobile && <TabBar />}
    </div>
  );
}
