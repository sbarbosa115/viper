/**
 * Product event properties (PRD section 3a, NFR-5): ids, counts, flags and enum values only.
 * Anything that could be personal data is dropped before an event is stored.
 */

const PERSONAL_KEY =
  /(^|_)(e?mail|name|first_?name|last_?name|phone|address|ip|password|token|secret|api_?key)$/i;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_LIKE = /^\+\d[\d\s().-]{6,}$|^\(\d{3}\)|^\d{3}[-.\s]\d{3}[-.\s]\d{4}$/;

export type EventPropertyValue = string | number | boolean | null;

function isSafeValue(value: unknown): value is EventPropertyValue {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return true;
  if (typeof value !== 'string') return false;
  return !EMAIL_LIKE.test(value) && !PHONE_LIKE.test(value);
}

/** Keeps only flat, non-personal properties: no nested objects, no emails, phones or names. */
export function safeEventProperties(
  properties: Readonly<Record<string, unknown>> | undefined,
): Record<string, EventPropertyValue> {
  const safe: Record<string, EventPropertyValue> = {};
  for (const [key, value] of Object.entries(properties ?? {})) {
    if (PERSONAL_KEY.test(key) || !isSafeValue(value)) continue;
    safe[key] = value;
  }
  return safe;
}
