/** A safe in-app return path from `?next=`: must start with one slash, never "//" or a scheme. */
export function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  return next;
}
