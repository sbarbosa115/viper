/** Leaves the app for Stripe Checkout. A seam so tests can observe it. */
export function redirectTo(url: string): void {
  window.location.assign(url);
}
