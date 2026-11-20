import type { PackOffer } from '@app/contracts/billing';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { creditsQueryKey, useMe } from '../../../shared/api/me';
import { Banner, Card, ErrorState, Skeleton, Spinner, StatTile } from '../../../shared/ui';
import { ApiError } from '../../../shared/api/client';
import { useCheckout, usePurchasePolling, useWallet } from '../api/hooks';
import { History } from '../components/history';
import { PackList } from '../components/pack-list';
import { copy, fill } from '../copy';
import { formatCredits } from '../lib/format';
import { redirectTo } from '../lib/redirect';

function checkoutMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'PAYMENTS_UNAVAILABLE') return copy.paymentsOff;
    if (error.code === 'EMAIL_NOT_VERIFIED') return copy.unverified;
    if (error.code === 'ACTING_AS_FORBIDDEN') return copy.actingAsForbidden;
    if (error.status === 404) return copy.packGone;
  }
  return copy.checkoutFailed;
}

function PurchaseBanner({ state }: { state: ReturnType<typeof usePurchasePolling> }) {
  if (state === 'waiting') {
    return (
      <Banner action={<Spinner size={16} label="" />}>{copy.pending}</Banner>
    );
  }
  if (state === 'done') return <Banner>{copy.done}</Banner>;
  if (state === 'timeout') return <Banner tone="warn">{copy.slow}</Banner>;
  return null;
}

/** FR-10 and FR-12: the wallet, the packs to buy and the ledger. */
export function CreditsPage() {
  const [params] = useSearchParams();
  const client = useQueryClient();
  const { me } = useMe();
  const wallet = useWallet();
  const checkout = useCheckout();
  const [pendingPackId, setPendingPackId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const purchase = usePurchasePolling(params.get('purchase') === 'success', wallet.data?.balance);

  const actingAs = me?.actingAs ?? null;
  const unverified = me !== null && !me.member.emailVerified;
  const disabledReason = actingAs
    ? null
    : !wallet.data?.paymentsAvailable
      ? copy.paymentsOff
      : unverified
        ? copy.unverified
        : null;

  const onBuy = (pack: PackOffer) => {
    setProblem(null);
    setPendingPackId(pack.id);
    checkout.mutate(pack.id, {
      onSuccess: ({ checkoutUrl }) => redirectTo(checkoutUrl),
      onError: (error) => {
        setPendingPackId(null);
        setProblem(checkoutMessage(error));
        if (error instanceof ApiError && error.status === 404) {
          void client.invalidateQueries({ queryKey: creditsQueryKey });
        }
      },
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 md:px-7">
      <h1 className="m-0 text-[26px] font-semibold tracking-tight text-fg">{copy.title}</h1>
      <PurchaseBanner state={purchase} />

      {wallet.isPending && <Skeleton className="h-24" role="status" aria-label="Loading credits" />}
      {wallet.isError && <ErrorState onRetry={() => void wallet.refetch()} />}
      {wallet.isSuccess && (
        <>
          <Card className="grid grid-cols-2 p-0">
            <StatTile label={copy.available} value={formatCredits(wallet.data.available)} highlight />
            <StatTile label={copy.reserved} value={formatCredits(wallet.data.reserved)} />
          </Card>

          <section aria-labelledby="credits-buy" className="flex flex-col gap-3">
            <h2 id="credits-buy" className="m-0 text-lg font-semibold text-fg">
              {copy.buyTitle}
            </h2>
            <p className="m-0 text-sm text-muted">{copy.policy}</p>
            {actingAs ? (
              <Banner>{fill(copy.actingAs, { business: actingAs.businessName })}</Banner>
            ) : (
              <>
                {disabledReason && <Banner tone="warn">{disabledReason}</Banner>}
                {problem && <Banner tone="warn">{problem}</Banner>}
                <PackList
                  packs={wallet.data.packs}
                  disabledReason={disabledReason}
                  pendingPackId={pendingPackId}
                  onBuy={onBuy}
                />
                <p className="m-0 text-xs text-faint">{copy.checkoutNote}</p>
              </>
            )}
          </section>
        </>
      )}

      <History />
    </div>
  );
}
