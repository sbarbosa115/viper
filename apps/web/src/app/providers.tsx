import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { RouterProvider } from 'react-router';
import { ApiError } from '../shared/api/client';
import { t } from '../shared/i18n';
import { ToastProvider } from '../shared/ui';
import '../styles/index.css';
import { createAppRouter } from './router';

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }
  override render() {
    return this.state.failed ? (
      <p role="alert" className="p-8 text-fg">
        {t('error.title')}. {t('error.body')}
      </p>
    ) : (
      this.props.children
    );
  }
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      },
    },
  });
}

export function Providers() {
  const [queryClient] = useState(makeQueryClient);
  const [router] = useState(createAppRouter);
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
