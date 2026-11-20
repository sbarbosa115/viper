import type { RouteObject } from 'react-router';

export { UnverifiedNotice } from './components/unverified-notice';

/** The auth feature's routes, mounted under /app by app/router.tsx. */
export const routes: RouteObject[] = [
  {
    path: 'signup',
    lazy: async () => ({ Component: (await import('./pages/signup-page')).SignupPage }),
  },
  {
    path: 'login',
    lazy: async () => ({ Component: (await import('./pages/login-page')).LoginPage }),
  },
  {
    path: 'login/two-factor',
    lazy: async () => ({ Component: (await import('./pages/two-factor-page')).TwoFactorPage }),
  },
  {
    path: 'verify-email',
    lazy: async () => ({ Component: (await import('./pages/verify-email-page')).VerifyEmailPage }),
  },
  {
    path: 'forgot-password',
    lazy: async () => ({
      Component: (await import('./pages/forgot-password-page')).ForgotPasswordPage,
    }),
  },
  {
    path: 'reset-password',
    lazy: async () => ({
      Component: (await import('./pages/reset-password-page')).ResetPasswordPage,
    }),
  },
];
