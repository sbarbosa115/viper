/** The ten fixed categories, in display order (prd-expenses section 6 conventions). */
export const CATEGORY_ORDER = [
  'hosting',
  'data_providers',
  'ai',
  'email',
  'domain_dns',
  'payments_fees',
  'software_tools',
  'legal_admin',
  'marketing',
  'other',
] as const;

export type Category = (typeof CATEGORY_ORDER)[number];

export const CATEGORY_LABELS: Readonly<Record<Category, string>> = {
  hosting: 'Hosting',
  data_providers: 'Data providers',
  ai: 'AI',
  email: 'Email',
  domain_dns: 'Domain & DNS',
  payments_fees: 'Payments fees',
  software_tools: 'Software & tools',
  legal_admin: 'Legal & admin',
  marketing: 'Marketing',
  other: 'Other',
};

/** Cost of revenue; every other category is an operating expense. */
export const COST_OF_REVENUE: readonly Category[] = ['data_providers', 'ai', 'payments_fees'];

export const isCostOfRevenue = (c: Category): boolean => COST_OF_REVENUE.includes(c);

export type ProviderCategory = 'ai' | 'data_providers';

/** Categories a bill may have when it covers a provider's usage (FR-2). */
export const COVERS_PROVIDER_CATEGORIES: readonly Category[] = ['ai', 'data_providers'];

/** Anthropic → AI, every other provider → Data providers (FR-6). */
export function providerCategoryOf(providerName: string): ProviderCategory {
  return providerName === 'Anthropic' ? 'ai' : 'data_providers';
}

export const categoryRank = (c: Category): number => CATEGORY_ORDER.indexOf(c);
