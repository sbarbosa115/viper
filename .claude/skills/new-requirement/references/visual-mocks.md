# Visual mocks: workflows and screens, before and after

The founder reviews changes visually. Words in a PRD are easy to misread, while a flow or a screen side by side with what exists today shows exactly what changes. These rules apply to `/new-requirement`, `/small-change` and `/build-requirement`.

## 1. Always use a Design artifact
Every mock goes on a **Design artifact**: the canvas with artboards that works like Photoshop or Figma. This includes screens, wireframes, navigation maps, sitemaps and workflow diagrams. Never use a plain HTML page, an ASCII sketch or a mermaid diagram as the deliverable. Mermaid is still fine inside docs.
- Start with the Artifact tool: `action: "quickstart"` with `intent: "design"`, then publish with the Design type's `type_url` and follow the instructions it returns.
- To add to an existing canvas, read it first and change its `project/canvas.json` and artboards in one go, then publish once.
- Style every screen with the project's design system (DESIGN.md, currently Midnight): its tokens, type and components. Use real copy and realistic data, never lorem ipsum.
- Write the canvas link into the PRD (§6b) and into `docs/design/mocks.md`.

## 2. Every new requirement gets a workflow comparison
Before writing the PRD, put one **Workflow** row on the canvas:
- **Before:** the user's flow as it works today, taken from the current boards listed in `docs/design/mocks.md`. If nothing exists yet, use a single card that says "Not possible today", plus how people manage now.
- **After:** the same flow with the requirement in place.
- Mark the differences consistently in both boards, and add a legend:

  | Change | Style |
  |---|---|
  | New step | accent outline plus a "NEW" tag |
  | Changed step | warn outline plus "CHANGED" and one line on what changed |
  | Removed step | faded and struck through, "REMOVED" |
  | Unchanged step | default style |

- Add a short note under the row listing each difference in plain words, with the FR it comes from once FRs exist.
- Arrows show the real order and branches, including the important failure paths: an error, no credits, no results.

## 3. Every UI change gets mobile and desktop, before and after
For each screen the change adds or alters, add one row of **four artboards**, in this order:

| 1 | 2 | 3 | 4 |
|---|---|---|---|
| Mobile · before | Desktop · before | Mobile · after | Desktop · after |
| 390 × 844 | 1440 × 900 | 390 × 844 | 1440 × 900 |

- **Before** is the screen as it is today: the latest approved mock, or the running app if it has moved on. For a brand-new screen, "before" is the screen people use today for this job. If there is none, use a placeholder artboard that says "No screen today" and names where people go instead.
- **After** uses the same data as before, so only the change differs. Mark changed regions with the same legend as the workflows.
- Show the state the change is about, for example the empty state, an error or the "Acting as" variant. Add extra rows for states that matter.
- Label each row with the route and the screen name from PRD §6b.

## 4. Approval before building
- Show the canvas link and ask for approval or changes **before** writing the PRD (in `/new-requirement`) and **before** coding (in `/small-change`). Revise the boards on the same canvas until the user approves.
- After approval, update `docs/design/mocks.md` so the "after" boards become the current baseline. The next requirement's "before" starts from there.
- During `/build-requirement`, each wave demo compares the built screens with the approved "after" artboards. If the build has to differ from them, mock the difference as before and after, using this file's rules, and get approval first.

## 5. Size it to the change
A one-field tweak needs one row of four artboards and no workflow row, unless the flow changes. A new requirement needs the workflow row plus a four-artboard row for every screen it touches. Don't mock screens the change doesn't affect.
