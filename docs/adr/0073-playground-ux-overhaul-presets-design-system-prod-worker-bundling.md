# ADR 0073: Playground UX overhaul — preset gallery, design system, production worker bundling, honest preview status

Status: Accepted (2026-06-03)
Date: 2026-06-03
Relates to: ADR-0011 (kernel worker URL injection — this refines its *build* path), ADR-0002/D-001 (cross-origin isolation), ADR-0017/ADR-0031/ADR-0046 (preview SW routing), ADR-0013/ADR-0072 (VFS backend / OPFS).

## Context

The playground (`apps/playground`, SolidJS) was a functional but raw dark IDE: inline styles everywhere, two hard-coded editor sources (`replSource`/`devSource`), no way for a first-time visitor to pick an example, and no hosting story. The task was to make it (1) immediately playable from presets, (2) visually modern, (3) hostable so the sandbox is reachable by users.

Two things only surfaced once a **production** build was exercised (the e2e suite and all prior development ran exclusively against `pnpm dev`):

1. **The production runtime worker never loaded.** `useRuntime` and `main.tsx` derived worker URLs with `new URL('../workers/worker-entry.ts', import.meta.url).href` and passed the string to `spawnRuntime` / `setKernelWorkerUrl`. Vite only emits + bundles a worker chunk when it can statically see `new Worker(new URL(...))`; the indirected string form is not recognised, so `vite build` shipped **no** `worker-entry`/`kernel-worker-entry` chunk. In dev Vite serves the raw `.ts` on demand (works); in prod the worker failed to load with an empty-message `ErrorEvent` → `[worker error] undefined` → `[worker exited: error]`, i.e. the REPL was dead in any hosted build. Confirmed pre-existing by building `HEAD` with the redesign stashed: same crash, no worker chunk.

2. **Monaco's language-service workers were unconfigured.** No `MonacoEnvironment.getWorker`, so the TS diagnostics adapter threw `Cannot read properties of undefined (reading 'toUrl')` on every keystroke — console spam in every environment.

## Decision

A single overhaul of the playground app (no package public-API changes), recorded here because it spans many files / >100 lines (IRREVERSIBLE by the reversibility checklist, rule 4).

1. **Preset gallery + auto-run.** New `src/presets.ts` (typed `Preset[]`) and `src/components/PresetGallery.tsx` (category-grouped, click-to-load left rail). Selecting a preset loads its source and transitions the mode machine; REPL presets auto-run for instant feedback. The menu (Welcome, Event-loop, Node core, Virtual filesystem, Dev server + HMR, Real Vite + npm) is **grounded in capabilities traced through the source** and covered by the e2e/conformance suites — no preset demonstrates anything that throws or fakes a result (Hard rule: no silent stubs). Notably **omitted**: "require an npm package from the REPL" (the REPL resolver roots at `/`, shell installs land in `/workspace/node_modules`), and an editable http-server preview preset (the editor entry in dev mode is the *client* `/src/main.js`, not the server).

2. **Design system ("terminal-luxe").** New `src/styles/theme.css`: CSS-variable tokens (cool-ink palette anchored on the terminal's hard-coded `#0f1115`, one acid-lime signal accent, hairline borders, film-grain overlay, staggered load), class-based components replacing inline styles. Self-hosted **OFL** fonts under `public/fonts` — IBM Plex Mono (UI/code) + Bricolage Grotesque (wordmark) — as bundled `.woff2` **assets** (not npm dependencies, no runtime CDN; COEP-credentialless safe). A custom Monaco theme (`rifty-dark`) anchors the editor on the same ink. The mode machine gains `loadPreset()` (the e2e-load-bearing `toggleDev`/`toggleRealVite` toggles are preserved verbatim). `EditorPanel` becomes reactive to external `value` changes so preset switching updates the editor.

3. **Production worker bundling (`?worker&url`).** `useRuntime.ts` and `main.tsx` now `import workerUrl from '../workers/worker-entry.ts?worker&url'` (and the kernel child entry likewise), which makes `vite build` emit + bundle the worker as a module chunk and return its URL. This fixes blocker (1) and *fulfils* ADR-0011's stated intent ("Vite … emits the worker chunk; the kernel never hardcodes a path"); it does not contradict it.

4. **Monaco workers.** New `src/glue/monaco-env.ts` sets `MonacoEnvironment.getWorker` from Vite `?worker` imports (TS worker for js/ts, editor worker otherwise) — kills blocker (2)'s console spam and moves diagnostics off the UI thread. `src/vite-env.d.ts` adds the `vite/client` types for the `?worker`/`?worker&url` imports.

5. **Honest preview status.** `PreviewPanel` polls the preview route until it answers (server up), navigates the iframe, then **checks whether the navigation actually committed** before reporting `live`; otherwise it shows `unavailable` with a hint. This never claims a working preview when the frame is blank. See the known limitation below.

6. **Hosting (Netlify).** `netlify.toml` (pnpm monorepo build, `publish = apps/playground/dist`, COOP/COEP headers mirrored from `public/_headers`, SPA fallback, Playwright-download skip). A favicon (`public/favicon.svg`, the lime diamond mark) removes the last 404.

## Known limitation (carried forward)

The in-page preview iframe **navigation** aborts (`net::ERR_ABORTED`) under cross-origin isolation even though a `fetch()` of the same route succeeds (the path M7 e2e exercises). Root cause is SW-side: `routePreview` resolves the owner from `resultingClientId` (ADR-0031), which for an iframe *navigation* is the iframe's own future client, not the main-thread bridge that owns the port. Routing sub-frame navigations to the controlling window is a change to public SW behaviour and reconsiders ADR-0031 → it needs a dedicated decision subagent + superseding ADR, out of scope here. Tracked in `OPEN_QUESTIONS.md` (Q-2026-06-03-308). The panel surfaces this honestly rather than papering over it; the four REPL presets (the core "click & play") render fully.

## Alternatives considered

- **Landing page → sandbox** vs **IDE + gallery.** User chose the polished IDE with a gallery rail (instant playability over a marketing hero).
- **Pixel display font (Departure Mono)** vs **grotesque (Bricolage).** Pixel read as "retro/gamey" against a polished IDE; the grotesque + mono pairing fits better. (Also, a reliable Departure Mono `.woff2` source wasn't available.)
- **Fix the SW preview routing now.** Rejected for scope: it is IRREVERSIBLE public SW behaviour and reconsiders a recorded ADR; deferred to a focused follow-up.
- **Theme the terminal** (IBM Plex Mono + exact ink). Rejected: `RiftyTerminal`'s theme is hard-coded and not in its options — exposing it is a public-API change (IRREVERSIBLE). The palette is anchored on the terminal's existing ink instead. Tracked as Q-2026-06-03-310.
- **Light theme.** Deferred (dark-only ships); tracked as Q-2026-06-03-309.

## Consequences

- (+) Hosted production builds finally work: the worker boots, presets run, COOP/COEP headers serve correctly (verified via `vite build` + `vite preview` + Playwright MCP, and the full e2e suite stays green: 18 passed / 1 skipped).
- (+) First-time visitors can click a preset and see output immediately; clean console (0 errors) on fresh load.
- (−) The main JS chunk is Monaco-heavy (~3.7 MB / ~960 KB gzip) — pre-existing; code-splitting Monaco is a separate optimisation.
- (−) The in-frame live preview remains blocked pending the SW routing fix (above).
- e2e still runs against `pnpm dev` only; the prod-build worker gap was invisible to CI. A follow-up to smoke the `vite preview` build in CI is worth considering (noted in `OPEN_QUESTIONS.md`).
