import { useState } from 'react';
import { Navigate } from 'react-router';
import { Skeleton } from '../../../shared/ui';
import { useProfile } from '../api/hooks';
import { ChatPage } from './chat-page';

/**
 * /app: the welcome chat until the profile is complete, then Plans (PRD 6b). Decided once, from
 * fresh data, so completing the profile mid-chat does not pull the Member away.
 */
export function HomePage() {
  const profile = useProfile();
  const [decided, setDecided] = useState<boolean | null>(null);
  if (decided === null && profile.isSuccess && !profile.isFetching) {
    setDecided(profile.data.complete);
  }
  if (decided === null) {
    if (profile.isError) return <ChatPage />;
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <Skeleton className="h-64" role="status" aria-label="Loading" />
      </div>
    );
  }
  return decided ? <Navigate to="/plans" replace /> : <ChatPage />;
}
