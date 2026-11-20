import { getPublicConfig } from '@app/contracts/platform';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { DataRouter } from 'react-router';
import { isTrackedRoute, loadGtag, routePaths, sendPageView } from '../shared/analytics/ga';
import { api } from '../shared/api/client';
import { useMe } from '../shared/api/me';

export const publicConfigQueryKey = ['public-config'] as const;

type TrackedRouter = Pick<DataRouter, 'subscribe' | 'state' | 'basename'>;

/**
 * FR-9: when Platform settings hold a GA measurement ID (GET /api/public/config), loads gtag once
 * and sends a `page_view` with the path only on start and on every navigation. Without an ID
 * nothing loads. Back-office routes and Acting-as sessions send nothing.
 */
export function GoogleAnalytics({ router }: { router: TrackedRouter }) {
  const config = useQuery({
    queryKey: publicConfigQueryKey,
    queryFn: () => api('/public/config', { schema: getPublicConfig.response }),
    staleTime: Infinity,
    retry: false,
  });
  const gaId = config.data?.gaMeasurementId ?? null;
  const { me, isLoading } = useMe({ enabled: gaId !== null });
  const location = useSyncExternalStore(router.subscribe, () => router.state.location);
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    // Wait for the Member so an Acting-as session is never counted.
    if (gaId === null || isLoading) return;
    if (lastKey.current === location.key) return;
    lastKey.current = location.key;
    const { page, route } = routePaths(router.basename, location.pathname);
    if (!isTrackedRoute(route, me?.actingAs != null)) return;
    loadGtag(gaId);
    sendPageView(gaId, page);
  }, [gaId, isLoading, me, location, router.basename]);

  return null;
}
