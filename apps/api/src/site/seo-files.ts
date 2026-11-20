import { legalSlugs } from '../../../web/src/site/index.js';

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** FR-34: `/robots.txt` keeps crawlers out of the app and the API. */
export function robotsTxt(siteUrl: string): string {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /app',
    'Disallow: /api',
    'Disallow: /site/signup',
    'Disallow: /site/login',
    '',
    `Sitemap: ${siteUrl}/sitemap.xml`,
    '',
  ].join('\n');
}

/** FR-34: `/sitemap.xml` lists the site pages (the landing page and the legal pages). */
export function sitemapXml(siteUrl: string, lastModified: Partial<Record<string, string>>): string {
  const paths = ['/', ...legalSlugs.map((slug) => `/${slug}`)];
  const urls = paths.map((path) => {
    const lastmod = lastModified[path];
    return [
      '  <url>',
      `    <loc>${xmlEscape(`${siteUrl}${path}`)}</loc>`,
      ...(lastmod ? [`    <lastmod>${xmlEscape(lastmod)}</lastmod>`] : []),
      `    <changefreq>${path === '/' ? 'weekly' : 'monthly'}</changefreq>`,
      `    <priority>${path === '/' ? '1.0' : '0.3'}</priority>`,
      '  </url>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}
