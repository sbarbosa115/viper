/**
 * The welcome Conversation's question order (FR-14): what you sell, where you are, how far you
 * deliver, who buys today; then, once the profile is complete, the Goal.
 */
export const TOPICS = [
  'products',
  'location',
  'locationConfirm',
  'radius',
  'currentCustomers',
  'priceRange',
  'website',
  'goal',
  'planCreated',
] as const;
export type Topic = (typeof TOPICS)[number];

export function isTopic(value: string | null): value is Topic {
  return value !== null && (TOPICS as readonly string[]).includes(value);
}

/** What the flow needs to know about the Business Profile. */
export interface ProfileProgress {
  readonly productsCount: number;
  readonly hasLocation: boolean;
  readonly hasRadius: boolean;
  readonly hasCurrentCustomers: boolean;
  readonly complete: boolean;
}

/**
 * The next question. Products, location and radius are asked until answered (they make the
 * profile complete); "who buys today" is asked once and may be skipped. Price range and website
 * are optional and not asked as separate turns: the Goal follows (AJ-1), and they can be told to
 * the assistant at any time or edited on the profile page.
 */
export function nextTopic(progress: ProfileProgress, asked: ReadonlySet<Topic>): Topic {
  if (progress.productsCount === 0) return 'products';
  if (!progress.hasLocation) return 'location';
  if (!progress.hasRadius) return 'radius';
  if (!progress.hasCurrentCustomers && !asked.has('currentCustomers')) return 'currentCustomers';
  return 'goal';
}

const MAX_REPLY = 600;
const MAX_QUICK_REPLIES = 4;
const MAX_QUICK_REPLY = 120;

/** An assistant reply: ≤ 600 chars, 0–4 distinct, non-empty quick replies (FR-14). */
export function shapeReply(
  text: string,
  quickReplies: readonly string[],
): {
  text: string;
  quickReplies: string[];
} {
  const clean = text.trim();
  const clipped = clean.length > MAX_REPLY ? `${clean.slice(0, MAX_REPLY - 1).trimEnd()}…` : clean;
  const seen = new Set<string>();
  const replies: string[] = [];
  for (const raw of quickReplies) {
    const r = raw.trim().slice(0, MAX_QUICK_REPLY);
    if (r === '' || seen.has(r.toLowerCase())) continue;
    seen.add(r.toLowerCase());
    replies.push(r);
    if (replies.length === MAX_QUICK_REPLIES) break;
  }
  return { text: clipped, quickReplies: replies };
}

/** "Cane sugar, 50 lb bag" → "cane sugar" (for goal quick replies). */
function shortProductName(name: string): string {
  const head = name.split(/[,(]/)[0]?.trim() ?? name;
  return head.charAt(0).toLowerCase() + head.slice(1);
}

function miles(radius: number): string {
  return radius === 1 ? '1 mile' : `${radius} miles`;
}

const GOAL_SEGMENTS = ['Bakeries', 'Restaurants', 'Coffee shops'] as const;

/**
 * Goal quick replies drafted from the Products (FR-14), e.g. "Bakeries within 3 miles that could
 * buy our cane sugar". The chat model may improve on them.
 */
export function goalSuggestions(products: readonly string[], radiusMiles: number | null): string[] {
  if (products.length === 0) return [];
  const area = radiusMiles && radiusMiles > 0 ? `within ${miles(radiusMiles)}` : 'near us';
  return GOAL_SEGMENTS.map((segment, i) => {
    const product = shortProductName(products[i % products.length] ?? products[0] ?? '');
    return `${segment} ${area} that could buy our ${product}`;
  });
}

/** Text a user may send (FR-14: 1–2,000 chars). */
export const MAX_USER_MESSAGE = 2_000;

/** Messages per Business per UTC day (FR-14: 60, then 429). */
export const DAILY_MESSAGE_LIMIT = 60;

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
