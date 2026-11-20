import type { Profile } from '@app/contracts/profile';
import { Link } from 'react-router';
import { Badge, Card, Skeleton } from '../../../shared/ui';
import { copy, fill } from '../copy';

interface Row {
  label: string;
  value: string | null;
  optional?: boolean;
}

function rowsOf(profile: Profile): Row[] {
  const a = profile.address;
  const place = profile.location?.label ?? [a.line1, a.city, a.state].filter(Boolean).join(', ');
  return [
    { label: copy.panelBusiness, value: profile.businessName },
    { label: copy.panelProducts, value: profile.products.map((p) => p.name).join(' · ') || null },
    { label: copy.panelLocation, value: place || null },
    {
      label: copy.panelRadius,
      value:
        profile.deliveryRadiusMiles === null
          ? null
          : `${profile.deliveryRadiusMiles} ${copy.miles}`,
    },
    { label: copy.panelCustomers, value: profile.currentCustomers },
    { label: copy.panelPrice, value: profile.priceRange, optional: true },
  ];
}

function progressOf(profile: Profile) {
  const rows = rowsOf(profile);
  return { rows, done: rows.filter((r) => r.value).length, total: rows.length };
}

/**
 * Below lg the panel is hidden; this one-line link above the chat shows the progress and opens
 * the Business Profile (approved mobile mock).
 */
export function ProfileProgressLink({ profile }: { profile: Profile | undefined }) {
  if (!profile) return null;
  const { done, total } = progressOf(profile);
  return (
    <Link
      to="/profile"
      className="flex items-center justify-between gap-2 rounded-control border border-line bg-surface px-3 py-2 text-sm font-medium text-fg"
    >
      <span>
        {copy.panelTitle}{' '}
        <span className="text-muted">{fill(copy.panelProgress, { done, total })}</span>
      </span>
      <span aria-hidden="true" className="text-accent">
        ›
      </span>
    </Link>
  );
}

/** The live Business Profile next to the chat (FR-14). */
export function ProfilePanel({ profile }: { profile: Profile | undefined }) {
  if (!profile) return <Skeleton className="h-64" role="status" aria-label="Loading profile" />;
  const { rows, done } = progressOf(profile);
  return (
    <Card aria-label={copy.panelTitle} role="complementary" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-base font-semibold text-fg">{copy.panelTitle}</h2>
        <Badge tone={profile.complete ? 'accent' : 'neutral'}>
          {fill(copy.panelProgress, { done, total: rows.length })}
        </Badge>
      </div>
      <dl className="m-0 flex flex-col gap-3">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-col gap-0.5">
            <dt className="text-xs font-medium text-muted">{r.label}</dt>
            <dd className="m-0 text-sm text-fg-2">
              {r.value ? (
                <>
                  <span aria-hidden="true" className="mr-1.5 text-accent">
                    ●
                  </span>
                  {r.value}
                </>
              ) : (
                <span className="text-faint">— {r.optional ? copy.optional : ''}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <Link to="/profile" className="text-sm font-medium text-accent">
        {copy.editProfile}
      </Link>
    </Card>
  );
}
