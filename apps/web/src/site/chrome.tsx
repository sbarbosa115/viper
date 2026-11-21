/** @jsxRuntime automatic */
// The pragma keeps the automatic JSX runtime when the api runs this file through tsx/esbuild.
import type { ReactNode } from 'react';
import { fill, siteCopy } from './copy.js';
import { siteCss } from './styles.js';
import { themeColor } from './tokens.js';
import { jsonLdText, shareImagePath, shareImageSize } from './seo.js';
import type { PageContext } from './types.js';

const fontsHref =
  'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap';

/** The Llyner icon, dark-background version (docs/brand/llyner-icon-dark.svg). */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 150 150" aria-hidden="true">
      <circle cx="75" cy="75" r="75" fill="#1877F2" />
      <circle cx="75" cy="75" r="64" fill="none" stroke="#FFFFFF" strokeWidth="4" />
      <path
        d="M35 81A12.5 12.5 0 0 1 60 81M89 81A12.5 12.5 0 0 1 114 81"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="9"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The LLYNER LEADS lockup, dark-background version (docs/brand/llyner-leads-dark.svg). */
export function Wordmark({ height = 32 }: { height?: number }) {
  return (
    <svg
      className="brand-wordmark"
      height={height}
      width={Math.round((height * 1360) / 300)}
      viewBox="50 40 1360 300"
      aria-hidden="true"
    >
      <g fill="none" strokeLinecap="butt" strokeLinejoin="miter">
        <path
          d="M280.5 177V163.5A105 105 0 0 1 490.5 163.5V177"
          stroke="#4C9AFF"
          strokeWidth="16"
        />
        <path
          d="M331.5 152A17.5 17.5 0 0 1 366.5 152M404 152A17.5 17.5 0 0 1 439 152"
          stroke="#4C9AFF"
          strokeWidth="12"
        />
        <g stroke="#EDEDF2" strokeWidth="16">
          <path d="M62 194V327H131.5" />
          <path d="M183 194V327H252.5" />
          <path d="M285.5 194L328 276L371 194M328 276V331.5" />
          <path d="M414.5 331.5V194L484.5 331.5V194" />
          <path d="M613 198H543V327H612.5M543 258.5H601.5" />
          <path d="M662 331.5V198H704C722 198 730.5 211 730.5 230S722 262 704 262H662M701 262L732.5 331.5" />
        </g>
        <g stroke="#9A9AA8" strokeWidth="16">
          <path d="M840 194V327H909.5" />
          <path d="M1029 198H959V327H1028.5M959 258.5H1017.5" />
          <path d="M1078 331.5L1104 198H1124L1150 331.5M1088 280H1140" />
          <path d="M1200 198H1235C1262 198 1272 225 1272 262.5S1262 327 1235 327H1200Z" />
          <path d="M1390 212C1382 201 1370 198 1356 198C1336 198 1324 209 1324 227C1324 246 1340 252 1357 258C1376 265 1390 272 1390 293C1390 315 1374 327 1354 327C1338 327 1326 321 1320 310" />
        </g>
      </g>
    </svg>
  );
}

export function PlayIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
      <path d="M9 6l11 7-11 7z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M2 5h14M2 9h14M2 13h14" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export interface HeadProps {
  ctx: PageContext;
  title: string;
  description: string;
  /** Path of this page, e.g. `/` or `/terms`. */
  path: string;
  jsonLd?: readonly Record<string, unknown>[];
}

/** `<head>`: SEO meta, canonical, Open Graph and Twitter tags, fonts, inline CSS, JSON-LD. */
export function Head({ ctx, title, description, path, jsonLd = [] }: HeadProps) {
  const canonical = `${ctx.siteUrl}${path}`;
  const image = `${ctx.siteUrl}${shareImagePath}`;
  return (
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
      <meta name="description" content={description} />
      {ctx.noindex ? <meta name="robots" content="noindex" /> : null}
      <link rel="canonical" href={canonical} />
      <meta name="theme-color" content={themeColor} />
      <link rel="icon" href="/site/icon.svg" type="image/svg+xml" />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={siteCopy.product} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content={String(shareImageSize.width)} />
      <meta property="og:image:height" content={String(shareImageSize.height)} />
      <meta property="og:image:alt" content={siteCopy.meta.shareImageAlt} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      {/* Loaded without blocking the first paint; the client script switches it to `all`. */}
      <link rel="stylesheet" href={fontsHref} media="print" data-fonts="" />
      <noscript>
        <link rel="stylesheet" href={fontsHref} />
      </noscript>
      <style dangerouslySetInnerHTML={{ __html: siteCss }} />
      {jsonLd.map((data, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdText(data) }}
        />
      ))}
      <script src={ctx.clientScriptSrc} defer />
    </head>
  );
}

/** `<body>` with the skip link and the GA measurement ID for the client script (FR-9). */
export function Body({ ctx, children }: { ctx: PageContext; children: ReactNode }) {
  return (
    <body data-ga-id={ctx.settings.gaMeasurementId ?? undefined}>
      <a className="skip" href="#main">
        {siteCopy.skipToContent}
      </a>
      <div className="page">{children}</div>
    </body>
  );
}

/** Section links: `#how` on the landing page itself, `/#how` from the legal pages. */
export function Header({ signedIn, onLanding }: { signedIn: boolean; onLanding: boolean }) {
  const at = (id: string) => (onLanding ? `#${id}` : `/#${id}`);
  const links = [
    { href: at('how'), label: siteCopy.nav.how },
    { href: at('features'), label: siteCopy.nav.features },
    { href: at('pricing'), label: siteCopy.nav.pricing },
    { href: at('faq'), label: siteCopy.nav.faq },
  ];
  const primary = signedIn ? (
    <a className="btn btn-primary header-cta" href="/app">
      {siteCopy.nav.openApp}
    </a>
  ) : (
    <a className="btn btn-primary header-cta" href="/#signup" data-tab-link="signup">
      {siteCopy.nav.startFree}
    </a>
  );
  return (
    <header className="site-header">
      <a className="brand" href="/" aria-label={siteCopy.product}>
        <Wordmark />
      </a>
      <nav className="nav" aria-label={siteCopy.nav.label}>
        {links.map((l) => (
          <a key={l.href} href={l.href}>
            {l.label}
          </a>
        ))}
      </nav>
      {signedIn ? null : (
        <a className="header-login" href="/?tab=login#signup" data-tab-link="login">
          {siteCopy.nav.logIn}
        </a>
      )}
      {primary}
      <details className="menu">
        <summary aria-label={siteCopy.nav.menu}>
          <MenuIcon />
        </summary>
        <nav className="menu-panel" aria-label={siteCopy.nav.label}>
          {links.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
          {signedIn ? (
            <a href="/app">{siteCopy.nav.openApp}</a>
          ) : (
            <a href="/#signup" data-tab-link="signup">
              {siteCopy.nav.startFree}
            </a>
          )}
        </nav>
      </details>
    </header>
  );
}

export function Footer({ ctx }: { ctx: PageContext }) {
  const f = siteCopy.footer;
  const email = ctx.settings.supportEmail;
  return (
    <footer className="site-footer">
      <span>{fill(f.copyright, { year: ctx.year })}</span>
      <nav className="footer-nav" aria-label={f.label}>
        <a href="/terms">{f.terms}</a>
        <a href="/privacy">{f.privacy}</a>
        <a href="/acceptable-use">{f.acceptableUse}</a>
        <a href="/cookies">{f.cookies}</a>
        {email ? (
          <a className="mono" href={`mailto:${email}`}>
            {email}
          </a>
        ) : null}
      </nav>
    </footer>
  );
}
