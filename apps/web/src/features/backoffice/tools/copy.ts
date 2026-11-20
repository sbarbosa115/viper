/** Staff-facing strings of the Tools & Rate card page (FR-23). */
export const copy = {
  title: 'Tools & Rate card',
  intro:
    '1 credit = $0.01 at list price. Margin = 1 − provider cost ÷ (credits × $0.01). Target 60% or more.',
  footnote: 'Provider prices are examples; check them against each provider before launch.',
  save: 'Save changes',
  saving: 'Saving',
  saved: 'Changes saved',
  nothing: 'No changes to save',
  saveFailed: 'Some changes were not saved. Fix the marked rows and try again.',
  caption: 'Tools and rate card',
  colTool: 'Tool',
  colProvider: 'Provider',
  colUnit: 'Unit',
  colCost: 'Cost / unit',
  colCredits: 'Credits / unit',
  colMargin: 'Margin',
  colEnabled: 'Enabled',
  colConfigured: 'Configured',
  colHealth: 'Health 24h',
  creditsLabel: 'Credits per unit, {name}',
  enabledLabel: 'Enabled, {name}',
  lowMargin: 'LOW MARGIN',
  notCharged: 'not charged',
  keySet: '✓ Key set',
  notConfigured: 'Not configured',
  none: '—',
  creditsRange: 'Enter 0.001 to 10,000',
  loadFailed: 'Tools did not load',
  emptyTitle: 'No tools',
  emptyHint: 'Tools are defined in code and appear here once registered.',
} as const;

export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}
