const files = import.meta.glob<string>('../../content/legal/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export const legalSlugs = ['terms', 'privacy', 'acceptable-use', 'cookies'] as const;
export type LegalSlug = (typeof legalSlugs)[number];

/** The raw Markdown of the four legal drafts; an empty string means the file is missing. */
export const legalDocuments: Record<LegalSlug, string> = {
  terms: files['../../content/legal/terms.md'] ?? '',
  privacy: files['../../content/legal/privacy.md'] ?? '',
  'acceptable-use': files['../../content/legal/acceptable-use.md'] ?? '',
  cookies: files['../../content/legal/cookies.md'] ?? '',
};
