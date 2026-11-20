import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { LegalSlug } from '../../../web/src/site/index.js';
import type { LegalContent } from './ports.js';

/**
 * Where the legal Markdown lives: next to the bundle in production (`dist/content/legal`, copied
 * by build.mjs), or in the web app's sources when running from the repo (tsx, Vitest).
 */
export function defaultLegalContentDir(): string {
  const candidates = [
    new URL('./content/legal/', import.meta.url),
    new URL('../../../web/src/content/legal/', import.meta.url),
  ].map((url) => fileURLToPath(url));
  const found = candidates.find((dir) => existsSync(`${dir}terms.md`));
  if (!found) throw new Error(`legal content not found in ${candidates.join(' or ')}`);
  return found;
}

/** Reads each draft once and keeps it: the files only change with a deploy. */
export function fileLegalContent(dir: string = defaultLegalContentDir()): LegalContent {
  const cache = new Map<LegalSlug, Promise<string>>();
  return {
    read(slug) {
      let text = cache.get(slug);
      if (!text) {
        text = readFile(`${dir.replace(/\/?$/, '/')}${slug}.md`, 'utf8');
        // A failed read is not kept, so the next request tries again.
        void text.catch(() => cache.delete(slug));
        cache.set(slug, text);
      }
      return text;
    },
  };
}
