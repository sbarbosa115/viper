/** Staff-facing strings of the credit packs page (FR-13). */
export const copy = {
  title: 'Credit packs',
  intro: 'Prices show on the landing page within 5 minutes. 1 credit = $0.01 at list price.',
  newPack: 'New pack',
  editPack: 'Edit {name}',
  caption: 'Credit packs',
  colPack: 'Pack',
  colCredits: 'Credits',
  colPrice: 'Price',
  colBonus: 'Bonus',
  colStatus: 'Status',
  active: 'Active',
  hidden: 'Hidden',
  edit: 'Edit',
  name: 'Name',
  credits: 'Credits',
  price: 'Price (USD)',
  activeLabel: 'Active (shown to customers)',
  save: 'Save pack',
  cancel: 'Cancel',
  saved: 'Pack saved',
  saveFailed: 'We could not save this pack. Try again.',
  gone: 'That pack no longer exists. The list has been refreshed.',
  emptyTitle: 'No credit packs yet',
  emptyHint: 'Create the first pack so customers can buy credits.',
  loadFailed: 'Credit packs did not load',
  required: 'Required',
  number: 'Enter a number',
} as const;

export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}
