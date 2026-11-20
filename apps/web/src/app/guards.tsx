import { Navigate, Outlet, useLocation } from 'react-router';
import { ErrorState, Spinner } from '../shared/ui';
import { useMe } from './me';
import { NotFoundPage } from './pages/not-found';

function FullPageSpinner() {
  return (
    <div className="grid min-h-screen place-items-center bg-bg">
      <Spinner />
    </div>
  );
}

/** Signed in, else /login with the requested page in `?next=`. Staff must pass two-factor first. */
export function RequireAuth() {
  const { me, isLoading, isSignedOut, error, refetch } = useMe();
  const location = useLocation();
  if (isLoading) return <FullPageSpinner />;
  if (isSignedOut) {
    const next = `${location.pathname}${location.search}`;
    const search = next === '/' ? '' : `?next=${encodeURIComponent(next)}`;
    return <Navigate to={`/login${search}`} replace />;
  }
  if (error || !me) return <ErrorState onRetry={refetch} />;
  if (me.twoFactor.required && !me.twoFactor.passed) {
    return <Navigate to="/login/two-factor" replace />;
  }
  return <Outlet />;
}

/** Staff with two-factor passed, else "Page not found" (the Back office is not advertised). */
export function RequireStaff() {
  const { me, isLoading } = useMe();
  if (isLoading) return <FullPageSpinner />;
  const allowed = me?.member.isStaff === true && me.twoFactor.passed;
  return allowed ? <Outlet /> : <NotFoundPage />;
}

/** Login and sign-up send a signed-in Member home (a Staff half-session goes to the code step). */
export function RedirectIfSignedIn() {
  const { me } = useMe();
  if (!me) return <Outlet />;
  if (me.twoFactor.required && !me.twoFactor.passed) {
    return <Navigate to="/login/two-factor" replace />;
  }
  return <Navigate to="/" replace />;
}
