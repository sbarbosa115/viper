# 0016. Public site rendered on the server at `/`, app at `/app`

- Status: Accepted
- Date: 2026-11-19
- Amends: ADR 0003 (single origin)

## Context
The landing page must rank in search, show live pack prices, and let visitors sign up or log in from the page. The SPA renders in the browser, so crawlers would see an empty page.

## Decision
One domain. The api service renders the public pages (landing, legal pages, sitemap.xml, robots.txt) on the server with `react-dom/server`, reusing the Midnight components from `apps/web/src/site/`, cached for 5 minutes. The SPA is built with `base: '/app/'` and served at `/app`. App Platform routes `/api` and `/` to the api service and `/app` to the static web component. The landing card's forms work without JavaScript through `POST /site/signup` and `POST /site/login`, which call the same identity use cases.

## Alternatives considered
- A separate site builder (Astro, Next.js): a fourth component to deploy and a second component library.
- Static prerendering: prices would be stale until the next build.
- `app.` subdomain: cross-subdomain cookies and CSRF handling for the landing form.

## Consequences
The api serves HTML as well as JSON, so its pages need the same caching and security headers as any site. Every app route moves under `/app`.
