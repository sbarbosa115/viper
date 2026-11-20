/** Customer-facing strings of the credits feature. */
export const copy = {
  title: 'Credits',
  available: 'Available',
  reserved: 'Reserved for running research',
  buyTitle: 'Buy credits',
  policy: 'Credits never expire and are not refundable. Sales tax is added at checkout.',
  checkoutNote: 'Buy opens Stripe Checkout and brings you back here.',
  buy: 'Buy',
  credits: 'credits',
  bonus: '{pct}% bonus',
  noPacks: 'No credit packs are available right now.',
  paymentsOff: "Payments aren't set up yet",
  actingAs:
    'You are acting as {business}. Buying credits is only available from the Owner’s own account.',
  actingAsForbidden: 'Buying credits is not available while you are acting as another business.',
  unverified: 'Verify your email to buy credits.',
  packGone: 'That pack is no longer available. The list has been refreshed.',
  checkoutFailed: 'We could not start checkout. Try again.',
  pending: 'Payment received, adding your credits…',
  done: 'Your credits were added.',
  slow: 'Your payment is taking longer than usual to confirm. Your credits will appear here as soon as it does.',
  historyTitle: 'History',
  historyCaption: 'Credit history',
  colDate: 'Date',
  colDescription: 'Description',
  colCredits: 'Credits',
  emptyHistory: 'No credit activity yet',
  emptyHistoryHint: 'Free trial credits, purchases and research costs will show up here.',
  more: 'Show more',
} as const;

export function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
