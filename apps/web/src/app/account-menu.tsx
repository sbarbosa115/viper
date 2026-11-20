import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Me } from '@app/contracts/identity';
import { api } from '../shared/api/client';
import { t } from '../shared/i18n';
import { cx } from '../shared/ui';
import { meQueryKey } from './me';

const legalLinks = [
  { href: '/terms', label: 'account.terms' },
  { href: '/privacy', label: 'account.privacy' },
  { href: '/acceptable-use', label: 'account.acceptableUse' },
  { href: '/cookies', label: 'account.cookies' },
] as const;

const itemClass =
  'flex min-h-10 w-full items-center rounded-sm px-3 text-left text-sm text-fg-2 hover:bg-raised hover:text-fg';

export function useLogout() {
  const navigate = useNavigate();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      client.clear();
      void navigate('/login', { replace: true });
    },
  });
}

export function AccountMenu({ me, align = 'right' }: { me: Me; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const client = useQueryClient();
  const logout = useLogout();
  const stopActing = useMutation({
    mutationFn: () => api('/staff/acting-as', { method: 'DELETE' }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: meQueryKey });
      await client.invalidateQueries();
      void navigate('/staff/customers');
    },
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const business = me.actingAs?.businessName ?? me.business.name;
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={t('account.menu')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid size-10 place-items-center rounded-full border border-line-control bg-surface text-sm font-semibold text-fg hover:bg-raised"
      >
        {business.slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t('account.menu')}
          className={cx(
            'viper-fade absolute top-12 z-40 w-64 rounded-row border border-line-strong bg-surface p-1.5 shadow-overlay',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          <p
            className="m-0 truncate px-3 py-2 text-sm font-semibold text-fg"
            title={t('account.business')}
          >
            {business}
          </p>
          <Link role="menuitem" to="/profile" onClick={() => setOpen(false)} className={itemClass}>
            {t('account.profile')}
          </Link>
          <div role="separator" className="my-1 h-px bg-line" />
          {legalLinks.map((l) => (
            <a key={l.href} role="menuitem" href={l.href} className={itemClass}>
              {t(l.label)}
            </a>
          ))}
          <div role="separator" className="my-1 h-px bg-line" />
          {me.actingAs && (
            <button
              role="menuitem"
              type="button"
              className={itemClass}
              onClick={() => stopActing.mutate()}
            >
              {t('account.stopActing', { business: me.actingAs.businessName })}
            </button>
          )}
          <button
            role="menuitem"
            type="button"
            className={itemClass}
            onClick={() => logout.mutate()}
          >
            {t('account.logout')}
          </button>
        </div>
      )}
    </div>
  );
}
