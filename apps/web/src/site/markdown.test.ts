import { describe, expect, test } from 'vitest';
import acceptableUse from '../content/legal/acceptable-use.md?raw';
import cookies from '../content/legal/cookies.md?raw';
import privacy from '../content/legal/privacy.md?raw';
import terms from '../content/legal/terms.md?raw';
import {
  escapeHtml,
  formatIsoDate,
  parseLegalDocument,
  renderInline,
  renderMarkdown,
} from './markdown';

describe('FR-33: Markdown for the legal pages', () => {
  test('renders headings with ids, paragraphs, lists, quotes and rules', () => {
    const html = renderMarkdown(
      [
        '## 1. The service',
        '',
        'First line',
        'continues here.',
        '',
        '- one',
        '- **two**',
        '  still two',
        '',
        '1. first',
        '2. second',
        '',
        '> quoted',
        '',
        '---',
        '### Small',
      ].join('\n'),
    );
    expect(html).toContain('<h2 id="1-the-service">1. The service</h2>');
    expect(html).toContain('<p>First line continues here.</p>');
    expect(html).toContain('<ul><li>one</li><li><strong>two</strong> still two</li></ul>');
    expect(html).toContain('<ol><li>first</li><li>second</li></ol>');
    expect(html).toContain('<blockquote><p>quoted</p></blockquote>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<h3 id="small">Small</h3>');
  });

  test('inline: bold, italic, code and safe links', () => {
    expect(renderInline('**b** and *i* and _u_ and `x<y`')).toBe(
      '<strong>b</strong> and <em>i</em> and <em>u</em> and <code>x&lt;y</code>',
    );
    expect(
      renderInline('[Terms](/terms) [mail](mailto:a@b.co) [web](https://x.test/a?b=1&c=2)'),
    ).toBe(
      '<a href="/terms">Terms</a> <a href="mailto:a@b.co">mail</a> <a href="https://x.test/a?b=1&amp;c=2">web</a>',
    );
  });

  test('escapes HTML and refuses script links', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
    expect(renderInline('[x](javascript:alert(1))')).not.toContain('href');
    expect(renderInline('[x](//evil.test)')).not.toContain('href');
    expect(renderInline('a "quote" & \'apostrophe\'')).toBe(
      'a &quot;quote&quot; &amp; &#39;apostrophe&#39;',
    );
    expect(escapeHtml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  test('placeholders in brackets are not links', () => {
    expect(renderInline('Questions: [SUPPORT EMAIL].')).toBe('Questions: [SUPPORT EMAIL].');
  });

  test.each([
    ['terms', terms, 'Terms of Service'],
    ['privacy', privacy, 'Privacy Policy'],
    ['acceptable-use', acceptableUse, 'Acceptable Use Policy'],
    ['cookies', cookies, 'Cookie Notice'],
  ])('%s: title, draft badge and date come out of the body', (_slug, markdown, title) => {
    const doc = parseLegalDocument(markdown, 'Fallback');
    expect(doc.title).toBe(title);
    expect(doc.draft).toBe(true);
    expect(doc.lastUpdated).toBe('2026-11-19');
    expect(doc.bodyHtml).not.toContain('Last updated:');
    expect(doc.bodyHtml).not.toContain('Draft for founder review');
    expect(doc.bodyHtml).not.toMatch(/<h1/);
    expect(doc.bodyHtml).toContain('<h2');
  });

  test('the Terms say credits never expire and are not refundable', () => {
    const doc = parseLegalDocument(terms, 'Terms of Service');
    expect(doc.bodyHtml).toContain('Credits never expire.');
    expect(doc.bodyHtml).toContain('Credits are not refundable.');
  });

  test('formats the date without time zones', () => {
    expect(formatIsoDate('2026-11-19')).toBe('Nov 19, 2026');
    expect(formatIsoDate('2027-01-02')).toBe('Jan 2, 2027');
  });
});
