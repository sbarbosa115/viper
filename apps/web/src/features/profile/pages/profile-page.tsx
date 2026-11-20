import { Link } from 'react-router';
import { ErrorState, Skeleton } from '../../../shared/ui';
import { useProfile } from '../api/hooks';
import { ProfileForm } from '../components/profile-form';
import { Products } from '../components/products';
import { copy } from '../copy';

/** FR-15: edit the Business Profile by hand. */
export function ProfilePage() {
  const profile = useProfile();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-7">
      {profile.isPending && (
        <div className="flex flex-col gap-4" role="status" aria-label="Loading profile">
          <Skeleton className="h-10" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      )}
      {profile.isError && (
        <ErrorState description={copy.loadFailed} onRetry={() => void profile.refetch()} />
      )}
      {profile.isSuccess && (
        <>
          <ProfileForm profile={profile.data} />
          <Products products={profile.data.products} />
          <p className="m-0 text-sm text-muted">
            {copy.footnote}{' '}
            <Link to="/chat" className="text-accent">
              {copy.openChat}
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
