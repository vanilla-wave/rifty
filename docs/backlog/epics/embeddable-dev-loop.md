---
kind: epic
status: ready
title: Embeddable dev-loop — rifty inside your app, your UI
created: 2026-07-10
value: A SaaS team embeds a full rifty dev-loop (editor + terminal + npm install + live preview) into its existing React app under its own layout/branding — from published packages, no playground fork.
user_story: As a SaaS developer, I want to mount a runnable Node sandbox (edit → npm install → vite dev → live preview) inside my existing React app with my own UI, but today that wiring is locked inside the Solid playground app — my only option is forking it.
items: [distribution/workbench-controllers, distribution/react-bindings, distribution/embed-host-vite-example]
sources: [ADR-0263, ADR-0273]
---

## Outcome

The primary distribution scenario: rifty consumed by embedding into an EXISTING product, not by visiting rifty.dev. Ladder strategy (user call 2026-07-10): deep project-session package (`@riftydev/workbench`) first, then ready components (`@riftydev/react`); the ready-solution tiers (iframe embed, `<RiftyIDE/>`, vue) come later and are NOT this epic. Mission anchor: every embed = real Node software (vite dev server, express, real npm install) running in a browser tab of someone else's product, self-hosted, no rifty.dev runtime dependency.

## User scenario

A SaaS developer with an existing Vite + React app:

1. `npm i @riftydev/sdk @riftydev/workbench @riftydev/react`.
2. Follows the embedding host doc (`embedding.md` in `docs/public/`, deliverable of `distribution/embed-host-vite-example`): COOP/COEP headers, host-resolved Worker/SW/WASM URLs in `deployment`, required self-hosted `packageAcquisition.registryUrl`, optional Eddy fields, and explicit storage policy (no default external endpoint — D-004).
3. Mounts own layout: `<RiftyProvider options={…} project={projects.vite(…)}>` wrapping `<RiftyEditor/>`, `<RiftyTerminal/>`, `<RiftyPreview/>` placed inside the SaaS's own components, branded via CSS custom properties.
4. End user opens the SaaS page: terminal runs real `npm install` (output scrolls), vite dev server boots, preview goes LIVE; user edits a file in the editor → preview updates via HMR.
5. Everything runs on the SaaS origin. Non-COI page / unsupported browser → the host's own fallback UI via `CapabilitiesGate`, never a broken mount.

Done when the in-repo reference host (a plain Vite React app standing in for the SaaS, importing only published-surface packages) passes exactly this flow as a CI e2e — against the BUILT app, not just dev.

## Items

- `distribution/workbench-controllers` — the deep base: owner-resident state authorities, generic ProjectRuntime with real Vite/server/CLI adapters, sealed project-session API, Playground dogfood, and packed Chromium proof. It moves ADR-0249's already-landed app-local storage/acquisition semantics, then blocks the other two.
- `distribution/react-bindings` — the ready components: `@riftydev/react` provider + atoms over the workbench, headless + themeable (DD-4).
- `distribution/embed-host-vite-example` — the acceptance vehicle: reference Vite React host app + the `docs/public/` embedding doc + CI e2e on the built bundle.

Out of scope for this epic: iframe tier (`distribution/iframe-embed`, draft — hosted embed, different persona: tutorial/course-site authors), vue + `<RiftyIDE/>` + default theme (residual `distribution/framework-bindings-kit`), `create-rifty-template` (scaffolds a NEW app; this epic embeds into existing ones), TS language service in the embedded editor (residual, named in `distribution/react-bindings`).
