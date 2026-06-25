# Handoff: rifty — Landing Page + Interactive Architecture Explorer

## Overview
A single marketing/landing page for **rifty** — a browser-based, Node-compatible runtime and WASI runner ("Node, npm, and a dev server inside a browser tab"). The page sells the project and, in its middle section, embeds a **fully interactive architecture explorer**: a draggable/zoomable node graph of the runtime's modules that can animate how a request flows through the system for six real scenarios (boot, `npm install`, an Express server + preview, Vite HMR, a WASI build, and a synchronous fs call).

The primary deliverable is **`Rifty.dc.html`** (landing + embedded explorer). The explorer is also available standalone as **`Rifty Architecture.dc.html`**.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes that demonstrate the intended look, layout, and behavior. They are **not** production code to ship as-is. They are authored as "Design Components" (a small custom HTML runtime: `*.dc.html` + `support.js`), which is an authoring convenience, **not** a target framework.

Your task is to **recreate these designs in the target codebase's existing environment** (React, Vue, Svelte, plain TS, etc.) using its established components, styling approach, and patterns. If no front-end environment exists yet, pick the most appropriate one (a React + Vite SPA is a natural fit here) and implement there.

The interactive graph logic (force-free fixed layout, drag/pan/zoom, BFS path-routing for scenarios, step animation) is described in detail below so you can reimplement it cleanly rather than porting the prototype's imperative DOM code.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, radii, and interaction behavior are all specified. Recreate the UI pixel-faithfully using the codebase's libraries. Exact hex values, font sizes, and weights are listed in **Design Tokens** and per-component below.

Note on theme: the page ships with a runtime **accent switcher** (lime/blue/cyan/violet) and **logo-mark switcher**. These are a prototype demo feature. Treat **lime `#C7F05A` as the canonical brand accent**; the alternate accents are optional and all driven by a single CSS variable (`--ac`) — see **Theming**.

---

## Screens / Views

There is one page (`Rifty.dc.html`), composed of a sticky nav + five stacked sections, plus a fixed control dock. Page background is a near-black `#15171D`; content max-width is `1200px` with `32px` side gutters (the explorer uses `1180px`).

### 0. Fixed control dock (bottom-center, `position: fixed`)
A floating pill, `bottom: 18px`, horizontally centered, `z-index: 120`.
- Container: `background: rgba(13,15,19,0.92)`, `backdrop-filter: blur(16px)`, `border: 1px solid rgba(255,255,255,0.12)`, `border-radius: 14px`, `box-shadow: 0 16px 48px rgba(0,0,0,0.6)`, padding `7px 9px`, `display:flex; gap:6px; flex-wrap:wrap`.
- **Accent group**: label `accent` (Roboto Mono, 10px, uppercase, `letter-spacing:0.08em`, color `rgba(255,255,255,0.34)`) + four 24×24 swatch buttons (`border-radius:7px`): lime `#C7F05A`, blue `#4A9EFF`, cyan `#3BDCE6`, violet `#A98BFF`. Active swatch has a 2px outline in its own color, `outline-offset:2px`.
- **Mark group**: label `mark` + four 30×30 buttons (`border-radius:8px`, `border:1px solid rgba(255,255,255,0.1)`) each holding a 17×17 inline-SVG logo glyph (rift / diamond / orbit / layers). Active button: `background: rgba(255,255,255,0.1)`, border `rgb(from var(--ac) r g b / 0.5)`.
- A 1px `rgba(255,255,255,0.12)` vertical divider separates the two groups.
- Switching accent recolors the **entire page including the embedded explorer** (one CSS var). Switching mark swaps every logo glyph on the page.

### 1. Sticky nav (`header`, `position: sticky; top:0; z-index:40`)
- Background `rgba(21,23,29,0.82)`, `backdrop-filter: blur(12px)`, bottom border `1px solid rgba(255,255,255,0.08)`, height `64px`, inner max-width `1200px`, padding `0 32px`, `display:flex; align-items:center; gap:28px`.
- Left: logo glyph (18×18, current mark, accent-colored) + wordmark `rifty` (Inter 600, 16px, `letter-spacing:-0.01em`, `#fff`) + a version chip `v0.x · M11` (Roboto Mono 11px, `rgba(255,255,255,0.34)`, 1px border, `border-radius:5px`, padding `2px 7px`).
- Center nav links (13px, `rgba(255,255,255,0.56)`): **Overview** (`#what`), **Architecture** (`#arch`), **Quick start** (`#start`).
- Right: a mono `$ npm i @riftydev/sdk` copy chip (12px, bg `#0E1014`, 1px border, `border-radius:6px`, padding `6px 10px`, with a copy icon) + a **Star** button (`#fff` text, 1px border `rgba(255,255,255,0.14)`, `border-radius:6px`, padding `7px 12px`, GitHub mark icon), linking to `https://github.com/vanilla-wave/rifty`.

### 2. Hero (`section`, two-column grid)
- `max-width:1200px`, padding `84px 32px 64px`, `display:grid; grid-template-columns:1fr 1fr; gap:56px; align-items:center`.
- **Left column:**
  - Eyebrow pill: `Browser-based Node runtime`. Inline-flex, Roboto Mono 11px uppercase `letter-spacing:0.06em`, color `var(--ac)`, bg `rgb(from var(--ac) r g b / 0.1)`, border `rgb(from var(--ac) r g b / 0.25)`, `border-radius:100px`, padding `5px 12px`. Leading 6px dot in `var(--ac)` pulsing (`rfPulse`, 2s ease-in-out infinite).
  - H1: "Node, npm, and a dev server — **inside a browser tab.**" — Inter 700, **56px**, `line-height:1.04`, `letter-spacing:-0.03em`, `#fff`; the clause "inside a browser tab." is in `var(--ac)`.
  - Sub-paragraph: 18px, `line-height:1.55`, `rgba(255,255,255,0.6)`, `max-width:480px`. **Note: the second sentence begins on a new line** (a `<br>` after "…built from scratch for the browser."). Inline `<code>` chips for `npm install` (accent text on `rgb(from var(--ac) r g b /0.08)`) and `.wasm` (`rgba(255,255,255,0.85)` on `rgba(255,255,255,0.06)`), Roboto Mono 15px, padding `1px 6px`, `border-radius:4px`.
  - CTA row (`gap:12px`): primary **Get started** (`#start`) — bg `var(--ac)`, text `var(--ac-ink)`, 14px/600, padding `12px 20px`, `border-radius:8px`, trailing arrow icon. Secondary **How it works** (`#arch`) — transparent, `#fff`, 1px border `rgba(255,255,255,0.16)`, same padding/radius.
  - Meta row: Roboto Mono 12px `rgba(255,255,255,0.4)`, slash-separated: `MIT licensed / ESM + .d.ts / Chrome-first / WASI preview1`.
- **Right column — "sandbox window"** mock: 1px border `rgba(255,255,255,0.1)`, `border-radius:12px`, bg `#0E1014`, `box-shadow:0 24px 60px rgba(0,0,0,0.5)`, `overflow:hidden`.
  - Title bar (`#14161B`, bottom border `rgba(255,255,255,0.07)`, padding `11px 14px`): three 11px traffic-light dots (`#3a3f4b`), a mono `localhost:3000` label, and a right-aligned **LIVE** indicator (mono 10px, `var(--ac)`, pulsing 5px dot).
  - Code block (Roboto Mono 12.5px, `line-height:21px`): a short `createSandbox()` snippet with syntax coloring — comment `rgba(255,255,255,0.3)`, keyword `#C79BF0`, function `#7CC5F5`, string `#9DD98F`, punctuation `rgba(255,255,255,0.55)`.
  - Terminal panel (`#0B0D11`, top border, `min-height:170px`): a mono label `● vite TERMINAL`, then an animated boot log (see **Terminal log** under Interactions).

### 3. "What you get" (`section#what`)
- `max-width:1200px`, padding `48px 32px 24px`.
- Section header: mono index `01` in `var(--ac)` + label `WHAT YOU GET` (13px/600, uppercase, `letter-spacing:0.08em`, `rgba(255,255,255,0.5)`), `gap:14px`, `margin-bottom:28px`.
- A **4-column feature grid** built as a 1px-gap grid over `rgba(255,255,255,0.08)` with a 1px outer border and `border-radius:12px` (so the gaps read as hairline dividers). Each cell: bg `#1A1D24`, padding `24px 22px`, `display:flex; flex-direction:column; gap:12px`:
  - 34×34 icon tile, `border-radius:8px`, bg `rgb(from var(--ac) r g b /0.1)`, holding a 17px line icon stroked in `var(--ac)`.
  - Title: 15px/600, `#fff`, `letter-spacing:-0.01em`.
  - Body: 13px, `line-height:1.5`, `rgba(255,255,255,0.5)`.
  - The four cells (title / body):
    1. **A real Node runtime** — "CJS + ESM loader and node: builtins. Real require, real import."
    2. **npm install, in-browser** — "semver resolve, registry fetch, unpack and link — no backend."
    3. **WASI preview1 runner** — "Run .wasm guests next to your JS, on the same virtual FS."
    4. **Virtual FS + OPFS** — "In-memory and persistent backends with a synchronous mirror."

### 4. "How it actually works" (`section#arch`) — the interactive explorer
- `max-width:1200px`, padding `64px 32px 24px`.
- Header: mono `02` + label `HOW IT ACTUALLY WORKS`. Intro paragraph (17px, `rgba(255,255,255,0.6)`, `max-width:640px`): "An interactive map of the runtime. Pick a scenario — npm install, an Express server, Vite HMR, a WASI build — and watch the request flow across the real package graph. Drag nodes, switch to the realm view, or inspect any module."
- Then the **embedded architecture explorer** (full spec in its own section below).

### 5. Quick start (`section#start`)
- `max-width:1200px`, padding `64px 32px 24px`. Header: mono `03` + `QUICK START`.
- Two-column grid (`grid-template-columns:1.3fr 1fr; gap:24px; align-items:start`):
  - **Left — code card** (`boot.ts`): 1px border, `border-radius:12px`, bg `#0E1014`. File-tab header (`#14161B`, mono 11px, file icon). `<pre>` body Roboto Mono 13px/22px, same syntax palette as the hero snippet — a `checkCapabilities()` + `createSandbox()` example.
  - **Right — two stacked cards:**
    - A **warning callout**: border `rgba(224,164,92,0.3)`, bg `rgba(224,164,92,0.06)`, `border-radius:10px`, padding `16px 18px`. Title row with a 15px warning-triangle icon stroked `#E0A45C` + "Cross-origin isolation required" (13px/600, `#E0A45C`). Body 13px `rgba(255,255,255,0.6)` explaining `SharedArrayBuffer` needs `COOP`+`COEP` so `crossOriginIsolated === true`.
    - A plain card (1px border, `border-radius:10px`) listing leaf installs (`npm i @riftydev/vfs`, `…/npm-client`, `…/shell`) in mono 12.5px, with a closing note.

### 6. CTA + footer (`section`)
- `max-width:1200px`, padding `80px 32px 96px`.
- **CTA panel**: 1px border `rgb(from var(--ac) r g b /0.22)`, `border-radius:16px`, background `radial-gradient(120% 140% at 80% 0%, rgb(from var(--ac) r g b /0.1), transparent 55%), #14161B`, padding `56px 48px`, centered.
  - H2 "Run Node in the tab." — 42px/700, `letter-spacing:-0.02em`, `#fff`.
  - Sub 17px `rgba(255,255,255,0.6)`, `max-width:440px`.
  - A mono `$ npm install @riftydev/sdk` chip, then a button row: primary **Read the docs** (accent) + secondary **View on GitHub**.
- **Footer row** under a `1px solid rgba(255,255,255,0.07)` top border, `margin-top:40px; padding-top:28px`, 13px `rgba(255,255,255,0.4)`: logo glyph + `rifty` + "— a pet project about understanding how these systems work." + right-aligned mono `M11 · Consumer Ready`.

---

## Embedded Architecture Explorer (the core interactive piece)

A self-contained widget. Standalone file: `Rifty Architecture.dc.html`. When embedded in the landing it runs in **`embedded` mode** (its own page chrome/header and its fixed bottom "view" dock are hidden; the view switcher is shown inline instead; the wrapper drops its min-height/padding/background so it flows in the section).

### Layout (top → bottom)
1. **Inline view switcher** (embedded mode only): label `view` + three pill buttons — **01 Schema**, **02 Realms**, **03 Hybrid**. Active pill: bg `var(--ac)`, text `var(--ac-ink)`, 600. Inactive: transparent, `rgba(255,255,255,0.62)`, 1px border `rgba(255,255,255,0.12)`.
2. **Scenario player bar** — a `#1A1D24` card, 1px border, `border-radius:12px`, `overflow:hidden`:
   - **Row A** (`padding:13px 16px`, bottom hairline): label `scenario`, then a **Whole schema** chip (grid icon — this is the default / "exit scenario" state), a 1px divider, then six scenario chips: **Boot**, **npm install**, **Express + preview**, **Vite HMR**, **WASI esbuild**, **Sync fs (SAB)**. Each chip: 1px border, `border-radius:7px`, padding `7px 13px`, 12.5px/500. Real-scenario chips carry a 6px leading status dot. Active chip: bg `rgb(from var(--ac) r g b /0.16)`, border `var(--ac)`, text `#fff`; its dot is `var(--ac)` and **pulses while the scenario is playing**.
   - **Row B** (`padding:13px 16px`): a title (`data-scn-title`, 13px/600 `#fff`) + a step counter (`N / M`, mono 11px, `var(--ac)`, hidden in Whole-schema mode) + a caption line (`data-step-caption`, 13px `rgba(255,255,255,0.6)`). **There are no prev/next/replay buttons** — interaction is chip-driven (see Interactions).
   - **Progress bar**: a 3px track (`rgba(255,255,255,0.06)`) with an inner fill in `var(--ac)`, width = `(step+1)/total`, `transition: width 0.25s linear`. Empty in Whole-schema mode.
3. **Legend row** (12px): **type** icons (UI surface, package · API, dev tool, runtime engine, kernel core, fs / net I/O, bridge · external), **realm** color squares (page/worker/service worker/iframe/external), **edge** styles (import = plain line, data = arrow, control = dashed `5 4` arrow, ipc = dashed `4 4` accent arrow). On the right: hint text "drag nodes · drag canvas to pan · scroll to zoom" + **−/+** zoom buttons and a **Reset** button (each 30px, `#1A1D24`, 1px border, `border-radius:7px`).
4. **Canvas viewport**: `position:relative; height:600px`, bg `#0E1014` with a dotted grid (`radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px); background-size:26px 26px`), 1px border, `border-radius:12px`, `overflow:hidden`, `cursor:grab`. Inside, an absolutely-positioned **world** layer (1120×~660 design units) that is `transform: translate(tx,ty) scale(s)`. A bottom-left **inspector** card (`position:absolute; left:14px; bottom:14px; width:296px`, bg `rgba(18,20,25,0.95)`, 1px border, `border-radius:10px`, `pointer-events:none`).

### The graph model
**Nodes (17)** — each has: `id`, `label`, `realm` ∈ {page, worker, sw, iframe, ext}, a **kind** (icon class), and a `role` description string (shown in the inspector).

| id | label | realm | kind |
|---|---|---|---|
| playground | Playground UI | page | UI surface (rendered as a mini code-editor card) |
| sdk | @riftydev/sdk | page | package · API |
| terminal | terminal | page | UI surface |
| shell | shell | page | dev tool |
| npm | npm-client | page | dev tool |
| runtimejs | runtime-js | worker | runtime engine |
| runtimewasi | runtime-wasi | worker | runtime engine |
| esbuild | esbuild.wasm | worker | runtime engine |
| vite | vite dev server | worker | runtime engine |
| kernel | kernel | page | kernel core |
| sab | SAB ring + Atomics | worker | kernel core |
| vfs | virtual FS | page | fs / net I/O |
| net | net + port registry | page | fs / net I/O |
| httpserver | http server | worker | fs / net I/O |
| sw | service worker | sw | bridge · external |
| preview | preview iframe | iframe | UI surface (rendered as a mini browser card) |
| registry | npmjs registry | ext | bridge · external |

The two "rich" nodes (`playground`, `preview`) render as small device frames instead of pills: `playground` is a code-editor card (traffic lights + filename tab + a syntax-highlighted snippet that changes per scenario), `preview` is a `localhost:3000` browser card whose body changes per scenario (e.g. "It works." for Express, "Counter: 3 · HMR applied" for Vite).

**Realm colors:** page `#7AA2FF`, worker `#3BD6C6`, sw `#B58BFF`, iframe `#F2B95C`, ext `#8A93A6`. Each plain node is a `#1A1D24` pill with a 3px left border in its realm color, a realm-colored dot + kind icon, the label (12.5px/600 `#fff`), and a kind sub-label (Roboto Mono 9.5px `rgba(255,255,255,0.42)`).

**Edges** are typed: `import` (plain), `data` (arrowhead), `control` (dashed `5 4` + arrow), `ipc` (dashed `4 4` + arrow, accent). Edges are drawn as straight SVG lines between node-border intersection points (recomputed live as nodes move). The full edge list is encoded in `Rifty Architecture.dc.html` (search `EDGES = [`) — port it verbatim.

**Realm zones** (Hybrid view only): four labelled translucent columns (PAGE / WORKERS / SERVICE WORKER / PREVIEW IFRAME) tinted with the realm colors; nodes are positioned inside their zone. The active scenario step's realm zone highlights.

### The three views
- **01 Schema** — free-form graph; nodes at hand-tuned positions (`DEFPOS`), all draggable.
- **02 Realms** — swim-lane style grouping by realm (non-graph; a column per realm).
- **03 Hybrid** — the graph **inside** the four realm zones (positions `HPOS`); combines structure + realm grouping.

Each view keeps its own pan/zoom (`view[impl] = {tx,ty,scale}`) and its own node positions.

### Scenarios (data)
Each scenario = an ordered list of **steps**; each step = `{ node, t }` where `t` is the caption. The animation does **not** jump straight between step nodes — for each consecutive pair it computes the **shortest path along real edges** (BFS over the adjacency graph) and lights that whole path. Scenarios (label · command · step nodes):
- **Boot** — `createSandbox({…})` — sdk → vfs → sw → kernel → runtimejs
- **npm install** — `npm install express` — terminal → npm → registry → npm → vfs
- **Express + preview** — `node server.js` — runtimejs → net → preview → sw → httpserver → preview
- **Vite HMR** — `vite` (edit `src/main.js`) — playground → vite → esbuild → net → preview
- **WASI esbuild** — `esbuild entry.ts --bundle` — shell → runtimewasi → esbuild → sab → vfs
- **Sync fs (SAB)** — `fs.readFileSync("/app.js")` — runtimejs → sab → kernel → vfs → runtimejs

(Exact captions per step are in the prototype under `SCN = {`. Port them verbatim.)

---

## Interactions & Behavior

### Theming (single source of truth)
- All accent usage resolves through CSS custom properties **`--ac`** (accent) and **`--ac-ink`** (readable text on the accent). The accent switcher sets `--ac`/`--ac-ink` on the document root; everything (landing + explorer) recolors instantly.
  - lime `#C7F05A` / ink `#15170B` (default) · blue `#4A9EFF` / `#061528` · cyan `#3BDCE6` / `#052422` · violet `#A98BFF` / `#1B0F33`.
- Many tints use CSS relative color: `rgb(from var(--ac) r g b / <alpha>)`. If your target can't use relative-color syntax, precompute per-accent rgba values or derive them in JS.
- The **mark switcher** swaps a logo glyph (rift / diamond / orbit / layers) everywhere it appears. Glyphs are simple inline SVGs filled with `var(--ac)`.
- In a production build you likely **don't need the switchers** — pick lime + the "rift" mark and hardcode, unless theming is a real requirement.

### Terminal log (hero)
A looping typewriter-style boot log: lines appear sequentially (`npm install express` → resolving → `+ express@4.21.2 · 57 pkgs · 0 conflicts` → `node server.js` → runtime line → `express listening on :3000` → `GET / 200 · 4 ms`), with a blinking block cursor (`rfBlink`, ~1.1s steps). Implement as a simple timed reveal; it's cosmetic.

### Explorer interactions
- **Pick a scenario chip** → resets to step 0 and **auto-plays**: steps advance every ~1150ms; the current node pulses (`rfNodePulse`), the active path's edges animate a flowing dash (`rfFlow`), already-visited nodes/edges stay lit, non-participants dim (nodes `opacity:0.26`, edges `0.14`), and (Hybrid) the active realm zone highlights. Title/caption/step-counter/progress update each step.
- **Click the currently-active scenario chip again** → replays it from step 0. (This replaces the removed Replay button.)
- **Whole schema chip** (default state) → exits any scenario; the **entire graph is shown at full visibility** (no dimming, no path animation, step-counter hidden, progress empty). This is the landing's default state.
- **Hover a node** (any time) → highlights that node + its direct neighbors and the edges between them; everything else dims; the inspector shows the node's label, kind, realm, role, and its "depends on / used by" lists.
- **Click a node** → pins it in the inspector.
- **Drag a node** → moves it; connected edges re-route live (recompute border-intersection endpoints). A drag must not also fire a click/select.
- **Drag empty canvas** → pans the world (updates `tx,ty`). **Scroll wheel** → zooms toward the cursor (`scale` clamped ~0.45–1.9). **−/+** buttons zoom about center; **Reset** restores that view's default positions and pan/zoom.
- **Switch view** (Schema/Realms/Hybrid) → swaps the layout; each view remembers its own positions + pan/zoom.

### Motion tokens
- General UI transitions: `0.15s linear` (Gravity-style). Node/edge state transitions ~`0.2s`. Pan/zoom is direct (no easing). Keyframes used: `rfPulse` (dot breathing, 2s), `rfBlink` (cursor), `rfFlow` (edge dash march, ~0.45s linear infinite), `rfNodePulse` (current-node ring, ~1.4s), `rfMarquee`/`rfSeam`/`rfRise`/`rfDrift`/`rfScan` exist in the source but are only used by the *other* landing variants (not this page) — ignore unless you port them.

---

## State Management

### Landing
- `accent` ∈ {lime, blue, cyan, violet} → sets `--ac`/`--ac-ink`.
- `icon` (mark) ∈ {rift, diamond, orbit, layers} → swaps logo glyphs.
- (Both are demo-only; safe to drop for production.)

### Explorer
- `impl` ∈ {1,2,3} — active view (Schema/Realms/Hybrid).
- `scn` — active scenario id, or `'none'` for Whole-schema (default).
- `step` — current step index within the scenario.
- `playing` — whether the auto-advance timer is running.
- `hover` — currently hovered node id (or null).
- `inspect` — pinned node id for the inspector.
- Per-view view transform `{tx,ty,scale}` and per-view node position maps.
- Derived per render: the **path state** = {touched nodes, done edges, current segment nodes/edges, all-scenario nodes/edges, current node} computed from the BFS-expanded scenario path up to `step`. Drives all node/edge styling.

No data fetching — everything is static/local.

---

## Design Tokens

### Color — surfaces & text
- Page bg `#15171D`; alt section bg `#121319` / `#101218`; panel `#1A1D24`; deep panels `#0E1014`, `#0B0D11`; title bars `#14161B`; CTA panel base `#14161B`.
- Nav bg `rgba(21,23,29,0.82)`; dock bg `rgba(13,15,19,0.92)`; inspector bg `rgba(18,20,25,0.95)`.
- Text: primary `#fff`; secondary `rgba(255,255,255,0.6)`; muted `rgba(255,255,255,0.5)`; hint `rgba(255,255,255,0.4)`; faint `rgba(255,255,255,0.34)` / `0.3`.
- Hairlines/borders: `rgba(255,255,255,0.08)` (default), `0.1`–`0.16` (stronger / hover).

### Color — accent (themeable via `--ac`)
- lime `#C7F05A` (ink `#15170B`) · blue `#4A9EFF` (`#061528`) · cyan `#3BDCE6` (`#052422`) · violet `#A98BFF` (`#1B0F33`).

### Color — explorer semantics
- Realm: page `#7AA2FF`, worker `#3BD6C6`, sw `#B58BFF`, iframe `#F2B95C`, ext `#8A93A6`.
- Compat (used by the standalone explorer's "compat" styling, if ported): ok = `var(--ac)`, warn `#F5B544`, no `#FF6B6B`.
- Warning callout: `#E0A45C` on `rgba(224,164,92,0.06)`, border `rgba(224,164,92,0.3)`.
- Code syntax: keyword `#C79BF0`, function `#7CC5F5`, string `#9DD98F`, number `#F2B95C`/`#F5B544`, punctuation `rgba(255,255,255,0.55)`, comment `rgba(255,255,255,0.3)`.

### Typography
- Sans: **Inter** (400/500/600/700). Mono: **Roboto Mono** (400/500/600/700). Both via Google Fonts.
- Hero H1 56px/1.04, 700, `-0.03em`. CTA H2 42px/1.06, 700, `-0.02em`. Hero sub 18px/1.55. Body 17px/1.5 and 13–15px. Section labels 13px/600 uppercase `+0.08em`. Eyebrows / mono labels 10–12px uppercase `+0.06…0.08em`. Node labels 12.5px/600; kind sublabels 9.5px mono.

### Spacing
- 4px-based, Gravity-aligned. Common: section vertical padding 48–84px; side gutters 32px; card padding 16–24px; grid/flex gaps 12–56px; explorer chip padding `7px 13px`.

### Radius
- Pills/dock 13–14px; cards 12px; smaller cards/callouts 10px; buttons/chips 6–9px; inline code 4px; status dots/swatches fully round or 7px.

### Shadow
- Sparse. Hero window `0 24px 60px rgba(0,0,0,0.5)`; dock `0 16px 48px rgba(0,0,0,0.6)`; otherwise borders do the work (Gravity convention).

---

## Theming & design-system note
This design is **rifty's own dark brand** (lime-on-near-black, Inter + Roboto Mono) but it is intentionally consistent with **Gravity UI** conventions: 1px hairline borders instead of shadows, 4px spacing base, small discrete radii, `0.15s linear` motion, sentence-case copy, no emoji, SVG-only icons. If your codebase already uses Gravity UI (or a similar token system), map these values onto its tokens rather than hardcoding; keep the lime accent + dark surfaces as the rifty skin.

## Assets
- **Fonts:** Inter + Roboto Mono (Google Fonts) — already linked in the HTML `<head>`.
- **Icons:** all inline SVG (feather/lucide-style line icons + a GitHub mark + the custom rifty logo glyphs + the kind/realm icons). No icon font, no image files. Redraw or map to your icon set (Lucide matches the line weight).
- **Images:** none — every "window"/"editor"/"browser" is pure CSS/SVG.
- No external/binary assets to migrate.

## Files
Included in this bundle:
- **`Rifty.dc.html`** — the merged landing page (Refined layout) with the embedded interactive architecture explorer. **Primary reference.**
- **`Rifty Architecture.dc.html`** — the architecture explorer, standalone (also runs embedded). Contains the authoritative `NODES`, `EDGES`, `SCN` (scenarios), `DEFPOS`/`HPOS` (positions), realm/kind metadata — **port these data structures verbatim**.
- **`support.js`** — the Design-Component runtime needed only to open the `.dc.html` files in a browser. **Not** part of the design; do not ship it.
- **`Rifty Landing.dc.html`** *(optional reference)* — the earlier multi-variant explorations (5 landing directions: Refined, Hybrid, Bold, In-Tab, No-Server). Not part of this deliverable, but useful to see alternative hero treatments.

To preview a file: open it directly in a modern Chromium browser (it self-boots via `support.js`).
