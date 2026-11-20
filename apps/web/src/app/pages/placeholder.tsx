import { t } from '../../shared/i18n';
import { EmptyState } from '../../shared/ui';

export interface PlaceholderProps {
  title: string;
  wave: number;
  headingLevel?: 1 | 2;
}

/** A routed screen that a later work package replaces. */
export function PlaceholderPage({ title, wave, headingLevel = 1 }: PlaceholderProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-7">
      <Heading className="m-0 text-[26px] font-semibold tracking-tight text-fg">{title}</Heading>
      <EmptyState
        headingLevel={3}
        title={t('placeholder.coming', { wave })}
        description={t('placeholder.body')}
      />
    </div>
  );
}
