---
paths:
  - "apps/web/**"
---

# Web app rules

Read these with spec §8.5, §11 (component breakdown and interface contracts), §13.2, §14.2–14.4, §14.8 and §16, and the wireframes README in `docs/design/wireframes/`.

## Server side

- Treat every server action and route handler as a public endpoint. Each one calls `getClaims()`, validates its input with the shared schema from `packages/contracts`, calls exactly one RPC function or Edge Function through the data access layer, maps the error code and returns a DTO. Nothing more. The one exception is `/api/health`, which signs nobody in and says only whether the database answers (spec §14.3).
- Never call `getSession()` in server code (a lint rule checks this, WEB-ACT-03).
- `src/proxy.ts` refreshes the session cookie and nothing else. It never allows or blocks a page (WEB-ACT-11).
- Data access lives in `src/server/` behind `import 'server-only'`. Components don't call Supabase directly. The exceptions are Realtime subscriptions and the chat insert, which goes through the Data API with the user's own session; Stripe.js and Mapbox load in the browser. ESLint allows Supabase imports only in `src/server/` and `src/proxy.ts`; the browser client for those exceptions lives in one module, which gets its exemption in the task that adds it.
- The web app holds only public values: the Supabase URL and publishable key, the URL-restricted Mapbox token and the Sentry DSN. Anything that needs a secret is an Edge Function.
- Redirect only to same-site relative paths. Refuse `//`, `/\` and absolute URLs in `next` parameters (WEB-ACT-09).
- Security headers and the CSP come from one place. Adding an origin to the CSP is a decision, so ask. Never allow `'unsafe-eval'`. `worker-src blob:` and `img-src data: blob:` are there for Mapbox.

## Structure

- Each feature has a folder in `src/features/<feature>/` holding its components, server actions and queries. Features don't import each other, except the safety feature's public `index.ts`, as on iOS (spec §12); shared pieces live in the shared foundation, `src/shared/`. Routes in `src/app/` may import features. ESLint's boundary rules enforce all of this.
- Error codes, messages and validation schemas come from `packages/contracts`. Never redefine them. A failed RPC or Edge Function call arrives with the HTTP status in spec §14.4 and the code as its message, in the same JSON body either way; map the code, not the status. `BLOCKED` gives no reason and names nobody.
- While the device is offline, show the offline notice and disable Join. Never queue a join for later (§14.4).
- Database types come from `packages/contracts`, regenerated after every migration.

## Interface

- The wireframes are a reference, not code to copy. Behaviour comes from the spec and the brief. Where a frame or the brief differs from the spec, build to the spec and log the difference in `docs/design/differences.md`; check that log before building a screen.
- Colours come only from the theme tokens (roles such as `--accent` and `--text2`, never hex values), in both the day and night themes. Type is IBM Plex Sans, with IBM Plex Sans Condensed for times and counts.
- One accent-filled button per screen. Never colour alone for a state. Counts come before names, age bands replace ages, and places stay approximate until someone joins. Times show in the activity's own time zone, with the zone named.
- WCAG 2.2 AA: targets at least 24 by 24 pixels, visible focus, keyboard alternatives to dragging, no sticky header covering focus, reduced motion respected, and pasting and autofill allowed in the code field.
- The feed uses native scroll snapping and the WAI-ARIA feed pattern (WEB-UI-11).
- Mapbox loads only when the map opens, through a dynamic import, in a classic 2D style with its logo and attribution visible. If it fails, show the list. Budgets: at most 200 KB of compressed JavaScript before the map opens, and a map chunk of at most 600 KB.
- Mapbox search results only move the map. Submit only the pin's coordinates, and never store a search result.
- Every list has empty, loading and error states. Toasts and errors are announced to screen readers.
- Render text escaped. Never use `dangerouslySetInnerHTML` with anything a user wrote.
- Store nothing non-essential in cookies or browser storage before consent. The theme is stored only once the user picks one.

## Tests

- Vitest and Testing Library tests sit beside the code. Playwright journeys go in `apps/web/e2e`, with axe on every key page in both themes.
- Name each test by its test specification ID. Logic takes `now` as a parameter instead of reading the clock.
- End-to-end journeys run in CI against a local Supabase stack, with the simulated verification provider and email in `log` mode: sign-in codes and app emails are read from the local inbox. The preview deployment gets only smoke tests, Lighthouse, axe and ZAP (§14.2), signed in as the staging test account through a session CI creates with the Auth admin API. Never add a password or test-only sign-in to the app for this.
