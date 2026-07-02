---
area: service-worker
status: draft
title: Preview top-level entry loses the SPA sub-path (router pathname space unpinned)
created: 2026-07-02
why: on real Node Vite, opening /issues/3 deep-links into the SPA route; in rifty a /preview/<port>/issues/3 entry serves the app but the router sees the prefixed pathname and the route is lost
user_story: As a playground user sharing a preview deep link into a React Router sub-route, I want the route to open like on a local dev server, but today it lands on the app root
sources: [ADR-0043, ADR-0183, tests/e2e/react-vite-preset.spec.ts]
code: [packages/service-worker/src/preview-bridge.ts, packages/service-worker/src/route-preview.ts, packages/net/src/cross-realm/preview-port.ts, apps/playground/src/templates/react-vite.ts]
---

## Context

Probe evidence (2026-07-02, playwright against the react-vite preset): top-level
`goto('/preview/5174/issues/3')` → guest index.html IS served (SPA fallback
through the SW works, client gets guest-scoped: subsequent clean-path requests
route to the dev server), but the document loads with pathname
`/preview/5174/issues/3`; React Router matches nothing; the template's
catch-all `<Route path="*" → Navigate to="/">` replaces the URL to `/` and the
Dashboard renders instead of the issue detail. Final URL: origin root, guest
content.

Two entangled findings:

- **Sub-path dropped on entry**: faithful behavior = the app's router sees
  `/issues/3` (as on local Node). Likely shape: SW-level redirect of top-level
  `/preview/<port>/<sub>` → `/<sub>` that registers the resulting client's
  port scoping before the redirected navigation — needs investigation of the
  existing client-scoping mechanism (`isTopLevelPreviewNavigation`,
  `copiedTopLevel`, preview-bridge clientId=null path).
- **The catch-all is load-bearing**: today an SPA template *needs* a
  redirect-to-root catch-all for the prefixed entry to recover; an ordinary
  NotFound catch-all page would break the preview entry. That is a hidden
  rifty-specific constraint on "portable" templates — the fix must remove it
  (after the fix, react-vite's catch-all can become an honest NotFound page).

In-app navigation, HMR, and URL query params inside the preview are unaffected
(react-vite e2e pins them green).

Refine before pickup: pin the intended preview URL-space semantics (what
pathname the guest app must observe; what the address bar shows) against real
Node + StackBlitz behavior, then contract the redirect + scoping change with
parity cases and a regression e2e (top-level `/preview/<port>/issues/3` renders
the issue-detail view).
