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
/** A same-app return path from `?next=` (must start with one `/`), else null. */
export function safeNext(search: string): string | null {
  const next = new URLSearchParams(search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

export function RedirectIfSignedIn() {
  const { me } = useMe();
  const location = useLocation();
  if (!me) return <Outlet />;
  const next = safeNext(location.search);
  if (me.twoFactor.required && !me.twoFactor.passed) {
    const query = next ? `?next=${encodeURIComponent(next)}` : '';
    return <Navigate to={`/login/two-factor${query}`} replace />;
  }
  return <Navigate to={next ?? '/'} replace />;
}
