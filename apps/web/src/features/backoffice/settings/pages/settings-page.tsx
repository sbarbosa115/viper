import { ErrorState, Skeleton } from '../../../../shared/ui';
import { useSettings } from '../api/hooks';
import { SectionForm } from '../components/section-form';
import { SmtpTest } from '../components/smtp-test';
import { copy, sectionOrder, sectionTitles } from '../copy';

/** FR-8: Platform settings, one form per section. */
export function SettingsPage() {
  const settings = useSettings();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-7">
      <h1 className="m-0 text-[26px] font-semibold tracking-tight text-fg">{copy.title}</h1>
      <p className="m-0 text-sm text-muted">{copy.intro}</p>
      {settings.isPending && (
        <div className="flex flex-col gap-3" role="status" aria-label="Loading settings">
          <Skeleton className="h-10" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      )}
      {settings.isError && (
        <ErrorState title={copy.loadFailedTitle} onRetry={() => void settings.refetch()} />
      )}
      {settings.isSuccess && (
        <>
          <nav aria-label={copy.sectionsNav} className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {sectionOrder.map((s) => (
              <a key={s} href={`#settings-${s}`} className="text-accent underline">
                {sectionTitles[s]}
              </a>
            ))}
          </nav>
          {sectionOrder.map((s) => (
            <SectionForm
              key={s}
              section={s}
              data={settings.data[s]}
              {...(s === 'email' ? { footer: () => <SmtpTest /> } : {})}
            />
          ))}
        </>
      )}
    </div>
  );
}
