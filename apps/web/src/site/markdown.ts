/**
 * A small, dependency-free Markdown renderer for the legal pages (FR-33): headings, paragraphs,
 * bullet and numbered lists, block quotes, rules, links, bold, italic and inline code. All text
 * is HTML-escaped first; links accept only http(s), mailto, site paths and anchors.
 */

const escapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => escapes[c] ?? c);
}

function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (/^(https?:\/\/|mailto:)/i.test(url)) return url;
  if (/^(\/(?!\/)|#)/.test(url)) return url;
  return null;
}

/** Inline Markdown on one block's text. Code spans are protected from the other rules. */
export function renderInline(text: string): string {
  const codes: string[] = [];
  let out = text.replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\uE000${codes.length - 1}\uE001`;
  });
  out = escapeHtml(out);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    // `href` is already escaped; unescape the ampersands to test the scheme, keep it escaped.
    const safe = safeHref(href.replace(/&amp;/g, '&'));
    return safe ? `<a href="${escapeHtml(safe)}">${label}</a>` : match;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
  return out.replace(/\uE000(\d+)\uE001/g, (_m, i: string) => codes[Number(i)] ?? '');
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

type ListKind = 'ul' | 'ol';
const bullet = /^\s*[-*+]\s+(.*)$/;
const numbered = /^\s*\d+[.)]\s+(.*)$/;

/** Block-level Markdown → HTML. Heading levels are kept (`##` → `<h2>`), each with an id. */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: { kind: ListKind; items: string[] } | null = null;
  let quote: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((item) => `<li>${renderInline(item)}</li>`).join('');
      html.push(`<${list.kind}>${items}</${list.kind}>`);
    }
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) html.push(`<blockquote><p>${renderInline(quote.join(' '))}</p></blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    if (line.trim() === '') {
      flushAll();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading?.[1] && heading[2] !== undefined) {
      flushAll();
      const level = heading[1].length;
      const inner = renderInline(heading[2]);
      html.push(`<h${level} id="${slugify(inner)}">${inner}</h${level}>`);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushAll();
      html.push('<hr>');
      continue;
    }
    const quoted = /^\s*>\s?(.*)$/.exec(line);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1] ?? '');
      continue;
    }
    const item = bullet.exec(line) ?? numbered.exec(line);
    if (item) {
      flushParagraph();
      flushQuote();
      const kind: ListKind = bullet.test(line) ? 'ul' : 'ol';
      if (list && list.kind !== kind) flushList();
      list ??= { kind, items: [] };
      list.items.push(item[1] ?? '');
      continue;
    }
    if (list && /^\s+\S/.test(line)) {
      // A continuation line of the current list item.
      const last = list.items.length - 1;
      list.items[last] = `${list.items[last] ?? ''} ${line.trim()}`;
      continue;
    }
    if (quote.length) flushQuote();
    flushList();
    paragraph.push(line.trim());
  }
  flushAll();
  return html.join('\n');
}

/** A legal draft split into what the page layout shows around the body. */
export interface LegalDocument {
  title: string;
  /** ISO date from the `**Last updated:** YYYY-MM-DD` line, or null. */
  lastUpdated: string | null;
  /** True while the draft line ("Draft for founder review…") is in the file. */
  draft: boolean;
  bodyHtml: string;
}

/**
 * Takes the `# Title`, the draft quote and the "Last updated" line out of the Markdown (the
 * layout shows them as a heading, a badge and a date) and renders the rest.
 */
export function parseLegalDocument(markdown: string, fallbackTitle: string): LegalDocument {
  let title = fallbackTitle;
  let lastUpdated: string | null = null;
  let draft = false;
  const kept: string[] = [];
  let titleTaken = false;
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const h1 = /^#\s+(.+?)\s*$/.exec(line);
    if (h1?.[1] && !titleTaken) {
      title = h1[1];
      titleTaken = true;
      continue;
    }
    const updated = /^\*\*Last updated:\*\*\s*(\d{4}-\d{2}-\d{2})\s*$/.exec(line.trim());
    if (updated?.[1] && !lastUpdated) {
      lastUpdated = updated[1];
      continue;
    }
    if (/^>\s*Draft for founder review/i.test(line.trim())) {
      draft = true;
      continue;
    }
    kept.push(line);
  }
  return { title, lastUpdated, draft, bodyHtml: renderMarkdown(kept.join('\n')) };
}

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-11-19` → `Nov 19, 2026` (no time zone involved). */
export function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const month = months[(m ?? 1) - 1];
  return month && y && d ? `${month} ${d}, ${y}` : iso;
}
