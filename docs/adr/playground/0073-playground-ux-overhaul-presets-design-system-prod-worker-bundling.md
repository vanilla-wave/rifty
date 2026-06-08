# ADR 0073: Playground UX overhaul — preset gallery, design system, production worker bundling, honest preview status

Status: Accepted (2026-06-03)
Date: 2026-06-03
Relates to: ADR-0011 (kernel worker URL injection — refines its *build* path), ADR-0002/D-001 (cross-origin isolation), ADR-0017/ADR-0031/ADR-0046 (preview SW routing), ADR-0013/ADR-0072 (VFS backend / OPFS).

> TL;DR: Playground overhaul: typed preset gallery + `terminal-luxe` token theme, prod workers bundled via `?worker&url` (not indirected URL strings), honest preview status

## Context

The playground (`apps/playground`, SolidJS) was a functional but raw dark IDE: inline styles, two hard-coded editor sources (`replSource`/`devSource`), no preset picker, no hosting. Goal: make it (1) instantly playable from presets, (2) visually modern, (3) hostable.

Two bugs surfaced only in a **production** build (e2e and all dev ran against `pnpm dev`):

1. **Prod runtime worker never loaded.** `useRuntime`/`main.tsx` built worker URLs via `new URL('../workers/worker-entry.ts', import.meta.url).href` and passed the string to `spawnRuntime`/`setKernelWorkerUrl`. Vite only emits a worker chunk for the statically-visible `new Worker(new URL(...))` form; the indirected string is not recognised, so `vite build` shipped no `worker-entry`/`kernel-worker-entry` chunk. Dev serves the raw `.ts` (works); prod failed with an empty `ErrorEvent` → `[worker error] undefined` → `[worker exited: error]` — REPL dead in any hosted build. Confirmed pre-existing (building `HEAD` with redesign stashed: same crash, no chunk).
2. **Monaco language-service workers unconfigured.** No `MonacoEnvironment.getWorker`, so the TS diagnostics adapter threw `Cannot read properties of undefined (reading 'toUrl')` on every keystroke (console spam everywhere).

## Decision

Single playground-app overhaul, no package public-API changes. Recorded here because it spans many files / >100 lines (IRREVERSIBLE per reversibility checklist rule 4).

1. **Preset gallery + auto-run.** New `src/presets.ts` (typed `Preset[]`) + `src/components/PresetGallery.tsx` (category-grouped click-to-load rail). Selecting loads the source and transitions the mode machine; REPL presets auto-run. Menu (Welcome, Event-loop, Node core, Virtual filesystem, Dev server + HMR, Real Vite + npm) is grounded in source-traced capabilities and covered by e2e/conformance — no preset throws or fakes (Hard rule: no silent stubs). **Omitted:** "require an npm package from the REPL" (REPL resolver roots at `/`; shell installs land in `/workspace/node_modules`) and an editable http-server preview preset (dev editor entry is the *client* `/src/main.js`, not the server).
2. **Design system ("terminal-luxe").** New `src/styles/theme.css`: CSS-variable tokens (cool-ink palette anchored on the terminal's hard-coded `#0f1115`, one acid-lime accent, hairline borders, film-grain overlay, staggered load), class-based components replacing inline styles. Self-hosted **OFL** fonts under `public/fonts` — IBM Plex Mono (UI/code) + Bricolage Grotesque (wordmark) — as bundled `.woff2` assets (no npm deps, no runtime CDN; COEP-credentialless safe). Custom Monaco theme `rifty-dark` on the same ink. Mode machine gains `loadPreset()` (e2e-load-bearing `toggleDev`/`toggleRealVite` preserved verbatim). `EditorPanel` made reactive to external `value` so preset switching updates the editor.
3. **Production worker bundling (`?worker&url`).** `useRuntime.ts` and `main.tsx` now `import workerUrl from '../workers/worker-entry.ts?worker&url'` (kernel child entry likewise), making `vite build` emit/bundle the worker as a module chunk and return its URL. Fixes blocker (1) and *fulfils* ADR-0011's intent ("Vite … emits the worker chunk; the kernel never hardcodes a path") — does not contradict it.
4. **Monaco workers.** New `src/glue/monaco-env.ts` sets `MonacoEnvironment.getWorker` from Vite `?worker` imports (TS worker for js/ts, editor worker otherwise) — kills blocker (2) spam, moves diagnostics off the UI thread. `src/vite-env.d.ts` adds `vite/client` types for the `?worker`/`?worker&url` imports.
5. **Honest preview status.** `PreviewPanel` polls the preview route until it answers, navigates the iframe, then checks whether navigation actually committed before reporting `live`; otherwise shows `unavailable` with a hint. Never claims a working preview for a blank frame. See limitation below.
6. **Hosting (Netlify).** `netlify.toml` (pnpm monorepo build, `publish = apps/playground/dist`, COOP/COEP headers mirrored from `public/_headers`, SPA fallback, Playwright-download skip). `public/favicon.svg` (lime diamond) removes the last 404.

## Known limitation (carried forward)

The in-page preview iframe **navigation** aborts (`net::ERR_ABORTED`) under cross-origin isolation even though `fetch()` of the same route succeeds (the path M7 e2e exercises). Root cause is SW-side: `routePreview` resolves the owner from `resultingClientId` (ADR-0031), which for an iframe *navigation* is the iframe's own future client, not the main-thread bridge owning the port. Routing sub-frame navigations to the controlling window changes public SW behaviour and reconsiders ADR-0031 → needs a dedicated decision subagent + superseding ADR, out of scope here. Tracked in `OPEN_QUESTIONS.md` (Q-2026-06-03-308). The four REPL presets (core "click & play") render fully.

## Alternatives considered

- **Landing page → sandbox** vs **IDE + gallery** — chose polished IDE with gallery rail (instant playability over a marketing hero).
- **Pixel display font (Departure Mono)** vs **grotesque (Bricolage)** — pixel read as "retro/gamey" against a polished IDE; grotesque + mono fits better (also no reliable Departure Mono `.woff2` source).
- **Fix SW preview routing now** — rejected for scope: IRREVERSIBLE public SW behaviour that reconsiders a recorded ADR; deferred to a focused follow-up.
- **Theme the terminal** (IBM Plex Mono + exact ink) — rejected: `RiftyTerminal`'s theme is hard-coded, not in its options; exposing it is a public-API change (IRREVERSIBLE). Palette anchored on the terminal's existing ink instead. Tracked Q-2026-06-03-310.
- **Light theme** — deferred (dark-only ships); tracked Q-2026-06-03-309.

## Consequences

- (+) Hosted prod builds work: worker boots, presets run, COOP/COEP headers serve (verified via `vite build` + `vite preview` + Playwright MCP; full e2e green: 18 passed / 1 skipped).
- (+) First-time visitors click a preset and see output immediately; clean console (0 errors) on fresh load.
- (−) Main JS chunk is Monaco-heavy (~3.7 MB / ~960 KB gzip) — pre-existing; code-splitting Monaco is a separate optimisation.
- (−) In-frame live preview remains blocked pending the SW routing fix (above).
- e2e still runs against `pnpm dev` only; the prod-build worker gap was invisible to CI. A follow-up to smoke the `vite preview` build in CI is worth considering (noted in `OPEN_QUESTIONS.md`).
