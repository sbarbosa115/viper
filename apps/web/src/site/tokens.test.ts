import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { siteCss } from './styles';
import { midnightTokens } from './tokens';

const tokensCss = readFileSync(resolve(__dirname, '../styles/tokens.css'), 'utf8');
const normalize = (v: string) => v.replace(/\s+/g, '').toLowerCase();

test('the site uses the same Midnight colour tokens as the app (DESIGN.md section 9)', () => {
  for (const [name, value] of Object.entries(midnightTokens)) {
    if (name.startsWith('--font-family')) continue;
    const match = new RegExp(`${name}:\\s*([^;]+);`).exec(tokensCss);
    expect(match, `${name} in tokens.css`).not.toBeNull();
    expect(normalize(value)).toBe(normalize(match?.[1] ?? ''));
  }
});

test('the site stylesheet never hard-codes a hex colour outside the token block', () => {
  const afterRoot = siteCss.slice(siteCss.indexOf('}') + 1);
  expect(afterRoot).not.toMatch(/#[0-9a-f]{3,8}\b/i);
});
