/**
 * Midnight tokens for the server-rendered public site (DESIGN.md section 9). The SPA reads them
 * from `styles/tokens.css`; the site cannot import CSS on the server, so it carries the same values
 * here (a test keeps both in step). Components use the CSS variables, never these hex values.
 */
export const midnightTokens = {
  '--bg': '#0a0a0f',
  '--bg-sunken': '#0d0d13',
  '--surface': '#13131a',
  '--surface-raised': '#1c1c26',
  '--line': '#1f1f29',
  '--line-strong': '#24242e',
  '--line-control': '#2e2e3a',
  '--text': '#ededf2',
  '--text-2': '#d4d4de',
  '--text-muted': '#9a9aa8',
  '--text-faint': '#80808e',
  '--accent': '#bef264',
  '--accent-hover': '#d9f99d',
  '--accent-ink': '#0a0a0f',
  '--accent-tint': 'rgba(190, 242, 100, 0.12)',
  '--accent-tint-weak': 'rgba(190, 242, 100, 0.06)',
  '--accent-line': 'rgba(190, 242, 100, 0.4)',
  '--warn': '#fbbf24',
  '--danger': '#fca5a5',
  '--overlay': 'rgba(0, 0, 0, 0.6)',
  '--font-family-sans':
    "'Geist', 'Geist Fallback', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  '--font-family-mono': "'Geist Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  '--shadow-overlay': '0 40px 80px rgba(0, 0, 0, 0.5)',
} as const;

export type MidnightToken = keyof typeof midnightTokens;

/** The browser chrome colour (`<meta name="theme-color">`): the page background. */
export const themeColor = midnightTokens['--bg'];
