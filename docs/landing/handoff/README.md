# Handoff: rifty landing — "Poster / Dark" (option 7a)

> [!NOTE]
> Frozen visual baseline for the 2026-09 redesign. Its copy, counts, and code samples are
> historical design input, not current project claims. Production facts live in
> `apps/landing/src/`, backed by the current compat matrix, `docs/public/publishing.md`, and the
> runtime code; where this bundle and the repo disagreed at port time (release stamp, package
> count, the `?worker&url` Worker import, the no-COI tier), `apps/landing/CHANGELOG.md` records the
> correction.

## Overview
Redesign of the rifty.dev landing (repo `vanilla-wave/rifty`, `apps/landing`). Same information architecture and copy source as the current landing (hero → demos → architecture explorer → package graph → quick start → CTA), restyled as a dark "brutalist poster": 2px rule grid, Archivo Black display type, a single lime accent, and three quiet visual nods to Peter Watts' *Rifters* trilogy (sonar ping behind the hero, a depth gauge along the right edge, a faint glow on the accent).

## About the design files
Files in this bundle are **design references written in HTML** — they show intended look and behavior, not production code. Recreate them inside `apps/landing` using its existing setup (Vite, TypeScript, plain DOM `render*()` section functions, per-section CSS files, `buildPresetHref` / `buildPlaygroundHref` from `playground-url.ts`). Keep the existing `explorer/data.ts` as the data source for the architecture map.

- `rifty-landing.html` — the full page, self-contained (loads Google Fonts + `rifty-explorer.js`). Open it in a browser.
- `rifty-explorer.js` — the interactive architecture explorer as a web component (`<rifty-arch>`). Its node/edge/scenario data was copied from `apps/landing/src/explorer/data.ts`; the visual treatment is what to port, not the data.

## Fidelity
**High-fidelity.** Colors, type, spacing, and copy are final. Recreate pixel-close. Copy is verbatim from the repo's README / landing sources except where noted.

## Page structure (single screen, 1080px content column, dark background fills the viewport)

Root: `background:#15171D; color:#F2F4F8; position:relative`. Content column `max-width:1080px`, centered. Every section is separated by a `2px solid rgba(255,255,255,0.16)` rule; the same rule is used for all inner grids/borders. No border radii anywhere. No shadows except the two glows listed under "Rifters accents".

### 0. Nav bar
Flex row, items stretch, bottom rule 2px.
- Logo cell: `RIFTY`, Archivo Black 18px, padding `16px 24px`, right rule 2px.
- Links: `DEMOS · OVERVIEW · ARCH · PACKAGES · START`, Roboto Mono 12px, `rgba(255,255,255,0.6)`, gap 22px, padding `0 24px`. Anchor to page sections.
- Right cell (margin-left:auto, left rule 2px, padding `0 24px`, gap 18px): `PLAY.RIFTY.DEV` (Roboto Mono 12/600, `rgba(255,255,255,0.7)`, → `buildPlaygroundHref`) and `GITHUB ↗` (`#C7F05A`, → github.com/vanilla-wave/rifty).

### 1. Hero
Padding `56px 40px 44px`, `position:relative; overflow:hidden` (hosts the sonar).
- Eyebrow: `OPEN RUNTIME · SELF-HOSTABLE — v0.x · M11 CONSUMER READY`, Roboto Mono 12px, letter-spacing .14em, `rgba(255,255,255,0.5)`, margin-bottom 22px.
- H1: Archivo Black 72px, line-height .98, letter-spacing −0.01em, uppercase, `#fff`, margin-bottom 28px. Three lines: `Node, npm &` / `a dev server —` / `in a tab.` The last line is an inline-block span with `background:#C7F05A; color:#15170B; padding:0 14px; box-shadow:0 0 34px rgba(199,240,90,0.35)`.
- Row (flex, gap 36, align-end, wrap): lead paragraph max-width 460px, 16px/1.55, `rgba(255,255,255,0.62)`: *"rifty is an open, self-hostable Node-compatible runtime and WASI runner for Chromium. Run tested Express, Vite 7, npm tooling and .wasm workflows — execution and files stay in the tab."* Buttons (margin-left:auto, gap 14): primary `RUN SOMETHING REAL` (bg `#C7F05A`, text `#15170B`, Roboto Mono 13/700, padding `15px 24px`, → playground); secondary `HOW IT WORKS` (transparent, `2px solid rgba(255,255,255,0.25)`, white text, padding `13px 24px`, → #arch).

### 2. Marquee
Height ~36px, bottom rule, `overflow:hidden`. Roboto Mono 12px `rgba(255,255,255,0.45)`, items separated by a lime `*`, gap 40px. Content repeated twice and translated −50% over 34s linear infinite: `MIT LICENSED · SELF-HOSTABLE · CHROMIUM-FIRST · NODE 24 PARITY TARGET · WASI PREVIEW1`. Respect `prefers-reduced-motion` (pause).

### 3. Terminal + four features
Grid `1.05fr 1fr`, bottom rule.
- Terminal (left, bg `#0E1014`, padding 28, right rule, Roboto Mono 13/1.8, text `rgba(255,255,255,0.82)`): comment line `// LIVE — /preview/3000/` at .4 alpha; `$ npm install express`; muted `resolve · fetch · verify · unpack · link`; green `#8FD98F` `+ express@4 — runs end-to-end`; `$ node server.js`; lime `express listening on :3000`; `GET /preview/3000/ 200` followed by an 8×15px lime block cursor blinking (steps(1), 1.1s) with `box-shadow:0 0 10px rgba(199,240,90,0.9)`.
- Features (right): 2×2 grid, cells padding 22, internal 2px rules. Title Archivo Black 13.5px white; body 13px `rgba(255,255,255,0.55)`. Copy: NODE RUNTIME / *CJS + ESM loader and tested node: builtin subsets. Real require, real import.* · NPM IN-BROWSER / *Resolve, fetch, verify, unpack, link — execution stays browser-local.* · WASI RUNNER / *.wasm guests next to your JS, same virtual FS.* · VFS + OPFS / *In-memory and persistent backends, sync mirror.*

### 4. `01 — RUN SOMETHING REAL` (demos)
Section padding `44px 40px`. Section label pattern used by 01/02/03: Roboto Mono 12px lime index+label; title Archivo Black 28px uppercase white; intro 14.5px `rgba(255,255,255,0.55)` max-width 600, margin-bottom 24.
- Title: *Three representative workflows.* Intro: *Dev tooling, server apps, and command-line programs. More presets live in the playground.* (both verbatim from `sections/demos.ts`).
- Grid: 3 equal columns inside a 2px rule box; cells padding 20, right rules between cells, `min-height:190px`, flex column gap 8.
- Cell anatomy: top row (flex, space-between) — glyph Archivo Black 16px lime, tag Roboto Mono 10px letter-spacing .1em `rgba(255,255,255,0.4)`; title 14.5/700 white; body 12.5/1.5 `rgba(255,255,255,0.55)`; footer row pushed to bottom with `margin-top:auto`, top hairline `1px solid rgba(255,255,255,0.12)`, padding-top 10, flex space-between: meta text left, `OPEN ↗` right (lime, 700, nowrap). The footer must be a flex row — this is what keeps the pointer aligned.
- Cards (id → glyph / tag / title / body / meta):
  - `real-vite` → DEV / TOOLING / *Dev server + HMR* / *Install packages and run a live development server with module transforms and HMR.* / `npm install · live preview`
  - `express-sqlite` → HTTP / SERVER APP / *HTTP server + database* / *Run a Node-compatible HTTP app with a WebAssembly-backed SQLite database.* / `npm install · live preview`
  - `cli-report` → CLI / COMMAND LINE / *CLI + project files* / *Run a Node-compatible CLI against the virtual filesystem and stream its output.* / `npm install · run to completion`
- Each card is one `<a>` with `href = buildPresetHref(id, VITE_RIFTY_PLAYGROUND_URL)` (→ `?preset=<id>&autorun=1`), `data-preset-card`, and the existing `aria-label`s from `demos.ts`. Hover: raise body/meta alpha to .75 (150ms).

### 5. `02 — HOW IT ACTUALLY WORKS` (architecture explorer)
Title *One tab, four realms.* Intro: *Everything runs in the page you opened. Dependencies flow top-down only — no reverse imports; the UI framework never leaks below the playground.*

Then the explorer (see `rifty-explorer.js`; port onto the existing `explorer/explorer.ts`, keeping `data.ts`). Visual spec:
- Stack of four boxes sharing 2px rules: scenario chip bar → status line → board → inspector.
- Chip bar (bg `#12151B`, padding `12px 14px`): label `SCENARIO` (10px, .12em, .4 alpha) + buttons Roboto Mono 11/600, padding `6px 10px`, `1px solid rgba(255,255,255,0.2)`, text .65 alpha; active = lime bg, `#15170B` text. Chips: Whole schema, Boot, npm install, Express + preview, Vite HMR, Raw WASI, Child sync fs (SAB). Click on the active scenario replays it.
- Status (bg `#0E1014`, min-height 64): scenario label 12/700 white; step counter + command `1 / 6 · $ npm install express` 10.5px lime; caption 11.5/1.5 .6 alpha; 2px progress bar (lime fill, width transition .5s).
- Board: fixed 1180×660 design space scaled to container width (`transform: scale`, height follows). Five realm columns with dashed 1px dividers (.09 alpha): PAGE (x0 w270, `#7AA2FF`), WORKERS (270/480, `#3BD6C6`), SERVICE WORKER (750/120, `#B58BFF`), PREVIEW IFRAME (870/170, `#F2B95C`), EXTERNAL (1040/140, `#8A93A6`). Zone head: name 11/700 in realm color, sub 9.5px .35 alpha. Active realm gets `rgba(255,255,255,0.03)` fill.
- Nodes: absolutely positioned (coordinates in `rifty-explorer.js` `POS`), centered on their point; bg `#12151B`, `1px solid rgba(255,255,255,0.22)`, left border 3px in realm color, Roboto Mono 11/600 white, padding `7px 11px`. States: `dim` opacity .22; `nb` (neighbor / on path) lime border .55; `tc` (touched in scenario) lime border .5 + `rgba(199,240,90,0.07)` fill; `cur` lime border + `rgba(199,240,90,0.16)` fill + 1px lime ring + 1.4s pulse ring to 12px; `pin` 1px lime outline offset 2. `esbuild JS API` carries an amber `⚠` (`#E0A45C`).
- Edges: SVG lines shortened 60/66px from node centers. Kinds: import (solid, no arrow), data (solid + arrow), control (dash `5 4` + arrow), ipc (dash `3 4` + arrow). Default stroke `rgba(255,255,255,0.28)` 1.2px. Hover: edges of hovered node lime 1.6px, rest .07. Scenario: current segment lime 1.8px; done segments `rgba(199,240,90,0.5)` 1.4px; future path `rgba(199,240,90,0.22)`; unrelated .06.
- Scenario playback: 1400ms per step, path between consecutive steps found by BFS over the undirected graph.
- Inspector (bg `#12151B`, min-height 44): node name 11.5/700 lime, realm tag 9.5px .1em in realm color, role text 11/1.5 .6 alpha. Empty state: `// selected runtime topology — solid = import · arrow = data · dashed = control · dotted = ipc` (10.5px .35 alpha). Hover shows the hovered node; click pins.

Below the explorer, margin-top 20: **The honest ceiling** box — border `2px solid rgba(224,164,92,0.35)`, header row `THE HONEST CEILING — gaps loud-throw instead of faking success` (Roboto Mono 11px .1em `#E0A45C`), then chips (padding `5px 10px`, 1px border, Roboto Mono 11.5px, text .75 alpha): amber ⚠ `node:https — fetch-backed`, red ✕ `raw TCP connect`, red ✕ `native modules`, amber `node:sqlite — in-memory`, amber `node:vm — QuickJS realm`, amber `30s force-kill drain`, amber `preview — buffered (M12)`. Amber border `rgba(224,164,92,0.4)`, red `rgba(255,107,107,0.4)`, red glyph `#FF6B6B`.

### 6. `03 — THE PACKAGE GRAPH`
Title *One umbrella, twelve packages.* Intro: *npm i @riftydev/sdk gets everything on a subpath. Each layer is also its own package — all ESM, shipping .d.ts, released in lockstep.*
Grid 4 columns × 3 rows in a rule box, cells padding 18: name Roboto Mono 13/700 white (sdk in lime on `#0E1014`), description 12px .5 alpha.
sdk / umbrella + createSandbox() · io / EventEmitter · Buffer · streams · vfs / memory + OPFS, sync mirror · kernel / processes · scheduling · IPC · net / node:net/http/ws + sqlite · runtime-js / CJS/ESM loader + builtins · runtime-wasi / WASI preview1 for .wasm · npm-client / semver · registry · link · shell / bash-flavoured, over the VFS · terminal / xterm.js wrapper · service-worker / preview/HMR routing bridge · shadow-registry / npm substitution tables.

### 7. `04 — quick start`
Grid `1.2fr .8fr`, bottom rule.
- Left code block (bg `#0E1014`, padding 28, Roboto Mono 12.5/1.8): keywords `#C79BF0`, strings `#9DD98F`, comment `// 04 — quick start (boot.ts)`. Code as in `rifty-landing.html` (imports `checkCapabilities, createSandbox` from `@riftydev/sdk`; capability check; `createSandbox({ workerUrl, serviceWorkerUrl })`; `sandbox.runtime.eval(...)`).
- Right (padding 28): heading `! CROSS-ORIGIN ISOLATION` Archivo Black 14px `#E0A45C`; header block (Roboto Mono 11/1.7 on `#0E1014`, 1px border .12): `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: credentialless`, `Cross-Origin-Resource-Policy: cross-origin` (values in amber); paragraph 13/1.55 .6 alpha: *SharedArrayBuffer + Atomics need these headers. GitHub Pages won't work; Netlify / Cloudflare Pages / Vercel do when configured.*; footer above a 2px rule: `leaf pkgs run anywhere, no headers:` / `io · vfs · npm-client · shell · shadow-registry`.

### 8. CTA + footer
Padding `56px 40px`, centered. `RUN NODE / IN THE TAB.` Archivo Black 52px/.98 uppercase. Install pill `$ npm install @riftydev/sdk` (Roboto Mono 13.5, `2px solid rgba(255,255,255,0.2)`, padding `13px 22px`; `$` at .4 alpha). Buttons: `PLAY.RIFTY.DEV ↗` (lime primary) and `GITHUB ↗` (outline). Footer line after a 2px rule, margin-top 36: `RIFTY.DEV — OPEN, SELF-HOSTABLE, BROWSER-LOCAL RUNTIME INFRASTRUCTURE · M11 CONSUMER READY · MIT`, Roboto Mono 11px .4 alpha.

## Rifters accents (visual only, decorative, `pointer-events:none`, `aria-hidden`)
1. **Sonar** (hero): 640×640 container absolutely positioned `top:50%; right:-160px; margin-top:-320px`. Three 1px circles `rgba(199,240,90,0.4)` animating `scale(.15)→scale(1)` with opacity `.8→0`, 7s linear infinite, delays 0 / 2.3 / 4.6s. Center dot 6px lime, `box-shadow:0 0 12px rgba(199,240,90,0.8)`, blinking 2.2s steps(1). Hero content sits above it (`position:relative`).
2. **Depth gauge**: 60px-wide strip pinned to the page's right edge, full height, `z-index:5`. Two repeating-linear-gradient tick rails at the very edge (8px wide: 1px ticks every 26px at .22 alpha; 16px wide: 1px ticks every 130px at .3 alpha). Vertical labels (`writing-mode:vertical-rl`, Roboto Mono 9.5px .35 alpha, right:22px) at top 8px `0 m`, 28% `−900 m`, 54% `−1 800 m`, 76% `−3 000 m`; bottom label `−3 300 m · vent` in `rgba(199,240,90,0.75)` with a 5px lime dot (`box-shadow:0 0 8px rgba(199,240,90,0.8)`) at bottom 14px / right 11px. Hide below 900px viewport width.
3. **Glow**: `box-shadow:0 0 34px rgba(199,240,90,0.35)` on the H1 lime span; `0 0 10px rgba(199,240,90,0.9)` on the terminal cursor.
All animations should pause under `prefers-reduced-motion: reduce`.

## Interactions & behavior
- Nav links smooth-scroll to sections; `HOW IT WORKS` → #arch.
- Demo cards → `buildPresetHref(id)`; whole card is the link.
- Explorer: hover → adjacency highlight + inspector; click → pin/unpin; chip → run scenario (auto-advance 1.4s/step; re-click replays; "Whole schema" resets). Scenario data = `SCN` in `rifty-explorer.js` (mirrors `data.ts` scenarios).
- Transitions 150–200ms linear on opacity/border; no other motion besides the listed loops.
- Responsive: below 1024px collapse 4-col grids to 2, the demos grid to 1, the two-column terminal/features and quick-start grids to 1 column; hide the depth gauge; explorer board scales with width (already handled by `ResizeObserver` in the component).

## State
Explorer only: `scenario: id|null`, `step: number`, `hover: nodeId|null`, `pin: nodeId|null`, `timer`. No data fetching; everything static.

## Design tokens
- Background `#15171D`; deep panel `#0E1014`; chrome panel `#12151B`; ink-on-lime `#15170B`.
- Accent lime `#C7F05A`; glow `rgba(199,240,90,.35/.9)`.
- Text: `#fff` / `#F2F4F8` primary; `rgba(255,255,255,0.62)` lead; `.55` body; `.5` meta; `.4` faint; `.35` labels.
- Rules `rgba(255,255,255,0.16)` 2px; hairline `rgba(255,255,255,0.12)` 1px; outline buttons `rgba(255,255,255,0.25)`.
- Realms: page `#7AA2FF`, worker `#3BD6C6`, sw `#B58BFF`, iframe `#F2B95C`, external `#8A93A6`. Warning `#E0A45C`, danger `#FF6B6B`, success `#8FD98F`, code keyword `#C79BF0`, code string `#9DD98F`.
- Type: Archivo Black (display: 72 / 52 / 28 / 18 / 16 / 14 / 13.5); Inter 400/700 (body 16 / 14.5 / 13 / 12.5); Roboto Mono 400–700 (13.5 / 13 / 12.5 / 12 / 11.5 / 11 / 10.5 / 10 / 9.5). Google Fonts.
- Spacing: section padding 44–56 × 40; cell padding 18–28; gaps 8 / 14 / 18 / 22 / 36.
- Radius: 0 everywhere (except sonar circles and dots). Shadows: only the two glows.

## Assets
No images or icons. Arrows (`↗`, `→`) are text glyphs; `⚠` / `✕` are text glyphs in the honest-ceiling chips. Fonts from Google Fonts.

## Files
- `rifty-landing.html` — the complete page (design reference).
- `rifty-explorer.js` — `<rifty-arch>` web component (explorer reference implementation; data copied from `apps/landing/src/explorer/data.ts`).
