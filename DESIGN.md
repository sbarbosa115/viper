# Viper Design System: Midnight

**Status:** Draft · **Updated:** 2026-11-19 · **Public name:** UI copy says "Llyner Leads" (Viper is the code name) · **Mockups:** [Viper Prospecting Proposal canvas](https://claude.ai/artifact/1hDti46b9PisXsVmHn13kS), row "Option A · Midnight"

Midnight is Viper's visual language: a dark, focused tool for people who work through lists of leads. It was chosen over *Daylight* (soft, light) and *Signal* (bold, editorial); both remain on the canvas for reference. This file is the source of truth for colors, type, layout and components. When a mockup and this file disagree, this file wins.

## 1. Principles

1. **Results first.** The lead, its score and how to contact it are always the most visible things on screen. Chrome stays quiet.
2. **Show the evidence.** Every score, contact detail and cost can be traced to a source or a breakdown. Never show a number the user can't question.
3. **Calm while the agent works.** Research runs in the background. While it runs, show one clear state ("Working on it", ETA, budget), never a live log.
4. **Money is always visible.** Credit balance, reserves and cost per lead appear wherever a decision costs credits.
5. **Fast for repeat use.** Split views, keyboard shortcuts, dense lists. A user should be able to work through 50 leads without leaving the page.
6. **One accent.** Lime marks the single most important action or signal on a screen. If everything is lime, nothing is.

## 2. Color

All colors are CSS variables (section 9). Text contrast is measured against `--bg`.

### Surfaces and lines
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#0A0A0F` | App background |
| `--bg-sunken` | `#0D0D13` | Side panels, inspectors, preview panes |
| `--surface` | `#13131A` | Cards, inputs, selected list row |
| `--surface-raised` | `#1C1C26` | User chat bubbles, active nav item, pressed chips |
| `--line` | `#1F1F29` | Dividers, table rows, panel borders |
| `--line-strong` | `#24242E` | Card borders |
| `--line-control` | `#2E2E3A` | Secondary buttons, inputs, chips |

### Text
| Token | Hex | Contrast | Use |
|---|---|---|---|
| `--text` | `#EDEDF2` | ~17:1 | Primary text, headings |
| `--text-2` | `#D4D4DE` | ~13:1 | Body copy, assistant messages |
| `--text-muted` | `#9A9AA8` | ~7:1 | Labels, metadata, breadcrumbs |
| `--text-faint` | `#80808E` | ~4.7:1 | Hints, footnotes. Never go darker for text |

> Fix in mockups: some footnotes use `#6E6E7C` (~4:1), which fails WCAG AA for small text. In the build, use `--text-faint`.

### Accent and status
| Token | Value | Use |
|---|---|---|
| `--accent` | `#BEF264` (lime) | The primary action, high fit scores, "verified" dots, "ready" states |
| `--accent-hover` | `#D9F99D` | Hover on accent buttons and links |
| `--accent-ink` | `#0A0A0F` | Text and icons on lime (~15:1) |
| `--accent-tint` | `rgba(190,242,100,0.12)` | Score badge background, selected chips |
| `--accent-tint-weak` | `rgba(190,242,100,0.06)` | Selected step, highlighted pitch card |
| `--accent-line` | `rgba(190,242,100,0.40)` | Border on accent-tinted cards |
| `--warn` | `#FBBF24` (amber) | Retrying runs, provider errors, low balance, STAFF badge |
| `--danger` | `#FCA5A5` | Destructive text actions ("Remove step", "Cancel") |
| `--reserved` | `#84CC16` | Reserved credits in the balance bar |

Rules:
- Status is never shown by color alone: pair it with a word or symbol ("● verified", "RETRYING", "○ generic inbox").
- Red is reserved for destructive actions and real errors. "Not a fit" or "no email found" is muted text, not red.

## 3. Typography

| Role | Font | Size / line height | Weight | Notes |
|---|---|---|---|---|
| Display (marketing) | Geist | 64 / 1.02 | 600 | letter-spacing −0.04em |
| Page title | Geist | 26–34 / 1.2 | 600 | letter-spacing −0.02em |
| Section title | Geist | 18–20 / 1.3 | 600 | |
| Overline label | Geist | 12 / 1.4 | 600 | UPPERCASE, letter-spacing 0.08em, `--text-muted` |
| Body | Geist | 15–16 / 1.6 | 400 | |
| Small / meta | Geist | 13 / 1.5 | 400 | `--text-muted` |
| Numbers, IDs, codes | Geist Mono | 12–56 | 400–500 | Credits, scores, phone numbers, emails, timestamps, step numbers |

- Load Geist and Geist Mono from Google Fonts (or the `geist` npm package) and self-host them in the build.
- **Numbers that the user compares (scores, credits, counts) are always mono.** They align, and they read as data.
- Minimum text size 12px; minimum for body copy 14px.

## 4. Space, shape and depth

- **Spacing scale (px):** 4, 8, 12, 16, 20, 24, 28, 32, 48, 64, 96. Page gutter 28 in the app, 24 on marketing pages.
- **Radii:** 6 (kbd, tiny tags) · 8 (filters, small buttons) · 10 (buttons, inputs) · 12 (list cards, steps) · 14–16 (cards, panels) · 18–20 (marketing cards, hero card) · 999 (pills).
- **Depth comes from lines, not shadows.** Cards use a 1px `--line-strong` border on `--surface`. The only shadows are on the marketing hero card and on overlays (menus, dialogs): `0 40px 80px rgba(0,0,0,0.5)`.
- **Selection** uses a 2px inset lime bar on the left edge (`box-shadow: inset 2px 0 0 var(--accent)`) plus `--surface`.

## 5. Layout

### App shell
```
┌──┬──────────────────────────────────────────────────┐
│v │ Breadcrumb / path                 ⌘K search  214 cr │  header 56px, bottom line
│◉ ├──────────────────────────────────────────────────┤
│◎ │                                                  │
│◇ │  content                                         │
│$ │                                                  │
│  │                                                  │
│⛨ │                                                  │
└──┴──────────────────────────────────────────────────┘
 72px icon rail
```
- **Icon rail (72px):** logo (lime square, links home), Plans/Assistant, Leads, Research flows, Credits; the **staff back office** (shield) is pinned to the bottom and is only visible to staff. Every icon button has an `aria-label` and a tooltip.
- **Header:** breadcrumb on the left (`Business / Section / Item`); search ("Search or ask Llyner… ⌘K") and the credit balance on the right.
- **Content patterns:**
  - **Conversation:** a centered column, max 680–820px (welcome chat, plan).
  - **List + preview:** list `flex 3`, preview `flex 2` on `--bg-sunken` (leads, flows).
  - **Editor + inspector:** canvas `flex 3`, inspector `flex 2` (flow editor).
  - **Stats strip:** a full-width row of key numbers under the header, cells divided by `--line` (leads, back office).
- **Responsive:** below ~1000px the panes stack (list above preview); below 640px the rail becomes a bottom bar. Wide tables scroll horizontally inside their own box. No horizontal page scroll.

### Marketing site (viper.com)
Same tokens and fonts, max width 1200px, sections separated by `--line` rules, generous spacing (80–96px vertical). No app rail.

## 6. Components

| Component | Spec |
|---|---|
| **Primary button** | `--accent` background, `--accent-ink` text, 600 weight, radius 10–12, height 40 (app) / 46–50 (marketing and key actions). One per view. May show a shortcut hint (`⌘↵`) |
| **Secondary button** | Transparent, 1px `--line-control` border, `--text` |
| **Inverse button** | `--text` background, `--bg` text. For non-primary but strong actions: Export CSV, Mark contacted |
| **Text button** | No border, `--text-muted`; `--danger` when destructive |
| **Input / textarea / select** | `--surface` background, 1px `--line-control` border, radius 10, height 40, focus ring 2px `--accent` |
| **Filter chip** | Height 32, radius 8, `--line-strong` border; selected → `--surface-raised` + `--text` |
| **Choice chip** (chat answers, targets) | Height 40, radius 10; selected → lime border, `--accent-tint` background, lime text; may contain a checkbox |
| **Fit score badge** | Mono, 44×44 (list) or inline pill; score ≥ 80 → lime on `--accent-tint`; 60–79 → `--text-2` on `--surface-raised` |
| **Verified marker** | `●` in lime plus the word "verified" in detail views; `○` = generic inbox; plain text = unverified. Always with a legend nearby |
| **Source tag** | Mono 11px `--text-muted` after a fact (`website/about`, `yelp/menu`, `3 sources`) |
| **Evidence row** | Mono points (`+18`) in lime, then the quote or fact in `--text-2`, then the source tag. Points add up to the fit score |
| **Pitch card** | `--accent-tint-weak` background, `--accent-line` border, overline "PITCH" in lime, *Copy pitch* button |
| **Stat cell** | Overline-style label (12px muted) above a mono number (18–56px). Cost per lead is lime |
| **List row (lead)** | Score · name (bold) + meta line · pitch · contact markers. Selected row gets the lime inset bar |
| **Step item** | Mono number (`01`) in a 32px rounded square, name, tools in muted text, credit cap in mono on the right; vertical connector line in timelines |
| **Status label** | Mono UPPERCASE 12px: `RUNNING` / `READY` (lime), `RETRYING` (amber), `DONE` (muted), `DRAFT` (lime) |
| **Working state** | Centered: thin ring (lime arc), status label, title "Working on it", one sentence with ETA, a 3-cell summary (flow, started, budget), "notify me" checkbox, actions |
| **Balance bar** | 6px bar: available (lime) + reserved (`--reserved`) over `--line` |
| **kbd** | Mono 11–12px, 1px `--line-control` border, radius 5–6 |
| **Chat** | Assistant: no bubble, `--text-2`, optional small "Llyner" label. User: `--surface-raised` bubble, radius 14, right-aligned, max 460–480px |
| **Table** | Header 12px `--text-muted`; rows 14px, 12–16px vertical padding, `--line` dividers; numbers right-aligned in mono |

Icons: 20px stroke icons, 1.8 stroke, round caps (Lucide is a good match). Never emoji.

## 7. Content and voice

- **Plain, confident, short.** "Working on it", "64 leads", "Find more", not "Your request is being processed".
- **Say what it costs before it costs.** Every action that spends credits shows the estimate ("Test on 10 businesses · ~12 cr", "Budget ≤ 300 cr").
- **Name things with the glossary terms:** Business Profile, Plan, Research flow, Step, Tool, Lead, Fit score, Evidence, Pitch, Credits.
- **Numbers:** credits as `286 cr`, distances `0.8 mi`, scores without "%". Times in the user's local time, 24-hour in the app.
- **Placeholders** in mockups (`[PRICE]`, `[N]`, `[$]`, `[%]`) are real gaps to fill, not design choices.

## 8. Interaction and accessibility

- **Keyboard:** `⌘K` search/ask · `J`/`K` next/previous lead · `↵` open · `C` copy pitch · `⌘↵` primary action (start research, send) · `Esc` close preview. Shortcuts appear as `kbd` hints where they help.
- **Focus:** visible 2px lime ring with 2px offset on every interactive element. Never remove outlines.
- **Targets:** at least 40px tall in the app, 44px on touch layouts.
- **Semantics:** real `<button>`, `<a>`, `<label>` and `<input>`; icon-only buttons get `aria-label`; the current nav item gets `aria-current`.
- **Contrast:** text tokens above meet WCAG AA on `--bg` and `--surface`; don't put `--text-muted` on `--surface-raised` for long text.
- **Motion:** only the working ring spins, plus 120–160ms ease-out fades for panels. Respect `prefers-reduced-motion`.
- **Theme:** dark only for the first release. If a light theme is added later, it derives from these tokens; Daylight on the canvas is the starting point.

## 9. Implementation (Tailwind v4 + shadcn/ui)

Define tokens once in `apps/web/src/styles/tokens.css` and map them for Tailwind and shadcn:

```css
:root {
  --bg: #0A0A0F;  --bg-sunken: #0D0D13;  --surface: #13131A;  --surface-raised: #1C1C26;
  --line: #1F1F29;  --line-strong: #24242E;  --line-control: #2E2E3A;
  --text: #EDEDF2;  --text-2: #D4D4DE;  --text-muted: #9A9AA8;  --text-faint: #80808E;
  --accent: #BEF264;  --accent-hover: #D9F99D;  --accent-ink: #0A0A0F;
  --accent-tint: rgba(190,242,100,0.12);  --accent-tint-weak: rgba(190,242,100,0.06);
  --accent-line: rgba(190,242,100,0.40);
  --warn: #FBBF24;  --danger: #FCA5A5;  --reserved: #84CC16;
  --font-family-sans: "Geist", system-ui, sans-serif;  --font-family-mono: "Geist Mono", ui-monospace, monospace;
  /* shadcn/ui aliases */
  --background: var(--bg);  --foreground: var(--text);
  --card: var(--surface);  --card-foreground: var(--text);
  --primary: var(--accent);  --primary-foreground: var(--accent-ink);
  --secondary: var(--surface-raised);  --secondary-foreground: var(--text);
  --muted: var(--surface);  --muted-foreground: var(--text-muted);
  --border: var(--line-strong);  --input: var(--line-control);  --ring: var(--accent);
  --destructive: var(--danger);  --radius: 10px;
}

@theme inline {
  --color-bg: var(--bg);  --color-sunken: var(--bg-sunken);  --color-surface: var(--surface);
  --color-raised: var(--surface-raised);  --color-line: var(--line);
  --color-fg: var(--text);  --color-fg-2: var(--text-2);  --color-muted: var(--text-muted);
  --color-accent: var(--accent);  --color-accent-ink: var(--accent-ink);
  --color-warn: var(--warn);  --color-danger: var(--danger);
  --font-sans: var(--font-family-sans);  --font-mono: var(--font-family-mono);
}
```

Rules for the build:
- Components live in `apps/web/src/shared/ui` (button, input, chip, score-badge, stat-cell, evidence-row, kbd, status-label, working-state, data-table). Features compose them and never hard-code hex values.
- Every shared component has a Vitest + Testing Library test for its states (default, selected, disabled, focus) and an accessible name.
- Check new screens against this file in review; a new pattern gets added here before it's used twice.

## 10. Screen inventory

All on the canvas, row "Option A · Midnight":

| # | Screen | Pattern |
|---|---|---|
| 0 | Home (results + assistant) | Conversation + list |
| 1 | Welcome chat → Business Profile | Conversation + profile panel |
| 2 | Plan | Conversation with plan card |
| 3 | Working on it | Working state |
| 4 | Leads with preview | Stats strip + list + preview |
| 5 | Lead detail | Contact with sources, evidence, pitch |
| 6 | Research flows | List + timeline preview |
| 7 | Flow editor | Editor + inspector |
| 8 | Credits | Balance, packs, activity table |
| 9 | Staff back office | Stats strip, tool catalog / rate card, agent runs |
| 10 | Public home page (viper.com) | Marketing |

Not designed yet: empty states (no plans, no leads), error states (run failed, card declined), team settings and invites, account settings, the email that announces "your leads are ready", and the mobile layout.
