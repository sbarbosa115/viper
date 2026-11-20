import { Link } from 'react-router';
import { t } from '../../shared/i18n';
import { EmptyState, Logo } from '../../shared/ui';

export function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-bg p-6">
      <div>
        <div className="flex justify-center">
          <Logo />
        </div>
        <EmptyState
          headingLevel={1}
          title={t('notFound.title')}
          description={t('notFound.body')}
          action={
            <Link
              to="/"
              className="inline-flex h-10 items-center rounded-control bg-accent px-4 text-sm font-semibold text-accent-ink hover:bg-accent-hover"
            >
              {t('notFound.home')}
            </Link>
          }
        />
      </div>
    </main>
  );
}
