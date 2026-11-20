/** @jsxRuntime automatic */
import { Body, Footer, Head, Header } from './chrome.js';
import { fill, siteCopy } from './copy.js';
import { formatIsoDate, parseLegalDocument } from './markdown.js';
import { legalSlugs, type LegalModel, type LegalSlug } from './types.js';

const l = siteCopy.legal;

/**
 * Fills the drafts' placeholders the site knows: `[SUPPORT EMAIL]` becomes a mailto link when
 * a support email is set (FR-8). The others stay for the founder to complete.
 */
export function withPlaceholders(markdown: string, supportEmail: string | null): string {
  if (!supportEmail) return markdown;
  return markdown.replaceAll('[SUPPORT EMAIL]', `[${supportEmail}](mailto:${supportEmail})`);
}

function LegalNav({ current }: { current: LegalSlug }) {
  return (
    <nav className="legal-nav" aria-label={l.navLabel}>
      <span className="overline">{l.overline}</span>
      {legalSlugs.map((slug) => (
        <a key={slug} href={`/${slug}`} aria-current={slug === current ? 'page' : undefined}>
          {l.titles[slug]}
        </a>
      ))}
    </nav>
  );
}

/** FR-33: a legal page rendered from its Markdown draft, readable without logging in. */
export function LegalPage({ model }: { model: LegalModel }) {
  const doc = parseLegalDocument(
    withPlaceholders(model.markdown, model.settings.supportEmail),
    l.titles[model.slug],
  );
  return (
    <html lang="en">
      <Head
        ctx={model}
        title={`${doc.title} · ${siteCopy.product}`}
        description={l.descriptions[model.slug]}
        path={`/${model.slug}`}
      />
      <Body ctx={model}>
        <Header signedIn={model.signedIn} onLanding={false} />
        <div className="legal">
          <LegalNav current={model.slug} />
          <main id="main" className="legal-doc">
            <div className="legal-head">
              {doc.draft ? <span className="draft">{l.draft}</span> : null}
              <h1>{doc.title}</h1>
              {doc.lastUpdated ? (
                <p className="updated">
                  <time dateTime={doc.lastUpdated}>
                    {fill(l.lastUpdated, { date: formatIsoDate(doc.lastUpdated) })}
                  </time>
                </p>
              ) : null}
            </div>
            <div className="prose" dangerouslySetInnerHTML={{ __html: doc.bodyHtml }} />
          </main>
        </div>
        <Footer ctx={model} />
      </Body>
    </html>
  );
}
