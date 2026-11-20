import { Outlet } from 'react-router';
import { Card, Logo } from '../shared/ui';

/** Centered card for the sign-in routes. The product name is the page's h1. */
export function AuthLayout() {
  return (
    <div className="grid min-h-screen place-items-center bg-bg p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo headingLevel={1} />
        </div>
        <Card className="p-6">
          <Outlet />
        </Card>
      </div>
    </div>
  );
}
