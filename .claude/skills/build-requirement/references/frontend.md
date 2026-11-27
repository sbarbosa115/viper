# Frontend (React + Vite)

## Layout (features mirror the API modules)
```
apps/web/src/
  main.tsx
  app/                     # orchestrator-owned: providers.tsx, router.tsx (lazy routes per feature)
  shared/
    api/client.ts          # fetch against relative /api, ApiError
    ui/                    # base kit from Wave 0 (read-only for feature agents)
    lib/                   # formatMoney, formatDate, ...
    analytics.ts           # track(event, props)
  features/
    <context>/
      api/                 # TanStack Query hooks: useOrders, useCancelOrder (typed with contracts)
      components/
      pages/
      test/handlers.ts     # MSW handlers for this feature (responses parsed with contract schemas)
      index.ts             # public: route objects for the router
  test/setup.ts            # jest-dom, MSW server loading every feature's handlers
```
Features never import another feature's internals. Anything shared goes to `shared/` through the orchestrator.

## Rules
- **Server state lives in TanStack Query**: caching, retries, and invalidation after mutations. Don't copy it into `useState` or a global store. Local UI state stays local.
- **Types come from `packages/contracts`.** The same Zod schemas validate the API, so frontend and backend can't drift.
- **Forms:** React Hook Form with `zodResolver` and the contract schema. Show field errors from client validation and from the API's `VALIDATION_ERROR` details.
- **Every screen handles its loading, empty and error states** (PRD §6b), using the `shared/ui` components so they look consistent.
- **Use the UI kit and Tailwind tokens.** Don't hand-roll colours, spacing or one-off buttons. Consistency is what makes a product feel finished.
- **Accessibility:** semantic HTML, labelled inputs, keyboard-reachable controls, focus management in dialogs, colour contrast at AA.
- **Analytics:** call `track()` for the events PRD §3a assigns to the frontend, such as views and clicks. Business events are emitted by the API.
- **Auth:** the session cookie is handled by the browser. Call `GET /api/auth/me` for the current user and protect routes with a `RequireAuth` wrapper. Never store tokens in localStorage.
- **No environment URLs:** the API is always the relative `/api`. Never put secrets in frontend env variables.
- Route-level code splitting with `React.lazy`. Keep components small and presentational, with logic in hooks.

## Build
`vite build` (with `base: '/app/'`) produces `apps/web/dist/`. nginx (the `web` image) serves it as the `web` static site at `/app`; `/ship-requirement` deploys it.
