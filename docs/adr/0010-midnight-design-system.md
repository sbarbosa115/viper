# 0010. Midnight design system

- Status: Accepted
- Date: 2026-11-18

## Context
Three visual directions were mocked up (Midnight, Daylight, Signal) on the design canvas.

## Decision
Midnight: a dark professional tool with one lime accent, Geist and Geist Mono, an icon rail, list-plus-preview layouts, keyboard shortcuts and scored Evidence. DESIGN.md at the repo root is the source of truth for tokens and components.

## Alternatives considered
- Daylight (soft, light, conversational): friendlier, less distinctive; kept as the basis for a future light theme.
- Signal (bold, editorial): memorable, but dense on small screens.

## Consequences
Dark only in the first release. All UI uses the DESIGN.md tokens; no hard-coded colours.
