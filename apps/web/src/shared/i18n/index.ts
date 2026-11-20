import { en, type StringKey } from './en';

export type { StringKey };
export { en };

/** Looks up a UI string and fills `{name}` placeholders. */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  const text: string = en[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
