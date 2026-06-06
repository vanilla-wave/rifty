# Changelog

## [Unreleased]

### Fixed

- **Real Vite preview now renders (and shows progress) instead of looking
  frozen (ADR-0077).** Three stacked breaks fixed: (1) `installProcessGlobals()`
  in the real-vite worker clobbered the kernel-wired `process.stdout`/`stderr`
  with `console.*`, so all install/boot logs — and error stacks — vanished
  (preserve the kernel stdio + env across the swap); (2) the kernel tore the
  worker realm down the instant `bootstrap()` resolved (`self.close()` on entry
  return), killing the Vite dev server right after it started listening → every
  preview request hit a dead worker (`502 bridge-timeout`) — the bootstrap now
  stays alive until `.kill()`; (3) the SW routed the iframe navigation to the
  wrong client (ported ADR-0074). Plus `PreviewPanel` warm-up now uses a
  per-probe `AbortController` + a 90 s budget so it spans an npm install and
  auto-loads to `live` (~22 s) without a manual Reload. Verified live:
  `/preview/<port>/` 200s, the iframe commits and renders the Vite app.
- **Dev-server console noise removed.** A custom Vite logger filters the
  harmless `Failed to load source map … marked.umd.js.map` warning (monaco 0.52
  ships `marked.umd.js` with a dangling sourcemap ref); dev-only, no runtime
  effect.
- **Console now scrolls.** `xterm.css` was linked from `index.html` as
  `/@xterm/xterm/css/xterm.css`, a path Vite never serves (it resolved to the
  SPA-fallback HTML in dev *and* prod), so xterm rendered without its
  stylesheet — `.xterm-viewport` had `overflow-y: visible` and zero height and
  the terminal could not scroll. Now imported from `main.tsx` (`@xterm/xterm`
  added as a direct dep) so Vite bundles it in dev and prod.

### Changed

- **Generic ProjectSpec/Template runtime — Vite is now just the default template
  (ADR-0078).** The "Real Vite" mode no longer hardcodes Vite across five files;
  a new playground-internal `ProjectSpec` value object (install deps, import
  specifier, createServer knobs, entry, seed files) drives the worker bootstrap,
  the orchestrator, and the mode machine via a new `RIFTY_RFV_TEMPLATE` env var.
  Adding a second runnable template is now a data change (a `ProjectSpec` + a
  preset row with a `templateId`) rather than a worker fork. The pure
  `resolveBootstrapConfig` mapping (incl. index.html-script-src derived from the
  entry) is unit-tested; user-facing "Real Vite" copy is generalised to "Real npm
  project" / "Dev server". Core packages were already Vite-free; no core change.
- **Single generic Templates switcher; header mode toggles retired (ADR-0079).**
  The duplicate header `Real Vite` / `Dev Mode` segment is removed — the
  Templates gallery is the one switcher (entering `dev`/`real-vite` is selecting a
  tile). The ActivityBar Templates button gains a stable `data-action`; the m7/m10
  e2e specs are updated as a **deliberate contract change** (new view-templates +
  `[data-preset]` flow; m10's stale `[real-vite] …` log markers corrected to the
  `[real-vite/worker] …` the worker actually emits). Resolves Q-2026-06-04-316.
- **Templates switcher polish.** The preset gallery is retitled **Templates**
  and its tiles now use vendored monochrome inline-SVG icons (new `icons.tsx`,
  Lucide/ISC paths, zero new dep) instead of full-colour emoji that clashed with
  the monochrome theme; presets declare a semantic `icon` key so the switcher
  scales cleanly to more templates. (Activity-bar tooltip follows: "Templates".)

### Added

- **Lazy `node_modules` browsing in the explorer (ADR-0080).** The reverse
  snapshot (ADR-0076) excludes `node_modules`; a new two-way request/response
  read bridge (`node-modules-port.ts`, the symmetric complement of the one-way
  write/snapshot ports) now lets the real-vite explorer browse it lazily — one
  directory level per expand, fetched from the worker and cached
  (`NodeModulesCache`), with loading/error rows and `node_modules` files opening
  read-only in the editor (≤128 KiB inline, larger shown size-only). A
  normalised-segment scope guard keeps it a package browser, not a general remote
  FS; over-cap files reply `content:null` (no silent empty read). The sync
  `FsOpsTarget` path is untouched — the async branch is keyed only on the
  `node_modules` subtree. Pure logic (the port round-trip, the cache, the
  `composeNodeModulesRows` interleave) is unit-tested.
- **File explorer reflects the Real Vite worker project (ADR-0076).** Switching
  to Real Vite now switches the explorer **into the Vite filesystem**: a new
  one-way worker→page VFS snapshot bridge (`vfs-snapshot-port.ts`, the mirror of
  the page→worker write port) publishes the worker realm's project tree — sans
  `node_modules` — which the page renders through a **read-only** `SnapshotFs`.
  The view is live (updates on install + every Vite watch), honestly read-only
  (mutation controls hidden, a `read-only` badge, worker files open view-only —
  no fake writes), and clears on leaving the mode. Closes the split-VFS gap
  ADR-0075 flagged for real-vite. Pure logic (`collectSnapshot`, `SnapshotFs`)
  is unit-tested.
- **VSCode-style shell (ADR-0075).** Recomposed the playground into a real
  workbench: a lime "alive-spine" **activity bar** toggling the sidebar between
  a **file Explorer** and the Presets gallery, an **editor tab bar** over a
  multi-model Monaco, the **console relocated to a bottom panel** (spanning the
  editor area; collapsible to a header strip without unmounting xterm), preview
  as a right "Simple Browser" pane in dev/real-vite, and a **status bar** (mode,
  active file, language, COI, relocated storage badge). All panels are
  **resizable + collapsible** via a hand-rolled zero-dep `<Splitter>` (pointer
  drag, double-click reset, `role="separator"` + arrow-key resize, persisted to
  `localStorage`, iframe-pointer guard during drag).
- **VFS file explorer (ADR-0075).** Lazy-expand tree of `/workspace` over the
  main-thread `syncMirror()` (reflects shell `npm install` + user edits): open,
  new file, new folder, rename (files and dirs via a real recursive copy), and
  delete-with-confirm; signature-gated 1.5 s poll (the VFS exposes no change
  events). New pure modules under `src/glue` (`file-tree`, `fs-ops`,
  `editor-tabs`, `layout-store`, `splitter-size`) with unit tests.
- **Multi-model editor tabs (ADR-0075).** One Monaco model per tab (`setModel`
  on switch — no spurious writes); a permanent **program tab** stays bound to
  `machine.source`/`setSource` (REPL Run + dev/real-vite HMR unchanged) under a
  single `suppressProgramEcho` guard; files opened from the explorer get their
  own model with debounced VFS write-back. `monaco-env` gains the json / css /
  html language workers.
- **Preset gallery — click-to-run examples (ADR-0073).** New `src/presets.ts`
  + `src/components/PresetGallery.tsx`: a category-grouped left rail of
  example programs (Welcome, Event-loop order, Node core modules, Virtual
  filesystem, Dev server + HMR, Real Vite + npm). Selecting a preset loads
  its source and switches mode; REPL presets auto-run. Every preset is
  grounded in a capability traced through the source and covered by the
  e2e/conformance suites — no stubs. The boot preset still prints
  `worker alive` (M1 e2e contract).
- **Design system "terminal-luxe" (ADR-0073).** New `src/styles/theme.css`
  with CSS-variable tokens (cool-ink palette, acid-lime accent, hairlines,
  film grain, staggered load), class-based components replacing inline
  styles, a custom Monaco `rifty-dark` theme, and self-hosted OFL fonts
  under `public/fonts` (IBM Plex Mono + Bricolage Grotesque, bundled
  `.woff2` assets — no CDN, no npm dep). New `public/favicon.svg`.
- **Honest preview status.** `PreviewPanel` warms up the route, navigates the
  iframe, and reports `live` only on a real navigation commit (else
  `unavailable` with a hint) — see ADR-0073's known-limitation note and
  OPEN_QUESTIONS Q-2026-06-03-308.
- **Netlify hosting (`netlify.toml`).** pnpm monorepo build, COOP/COEP
  headers (mirrored from `public/_headers`), SPA fallback, prod publish of
  `apps/playground/dist`.
- **`useMode.loadPreset()` + `useRuntime.whenReady()/isRunning()`.** Preset
  loading transitions modes; REPL eval gates on worker readiness.

### Fixed

- **Production runtime worker never loaded (ADR-0073).** `useRuntime.ts` and
  `main.tsx` now import the worker entries via `?worker&url` instead of
  `new URL(..., import.meta.url)`, so `vite build` actually emits + bundles
  the `worker-entry` / `kernel-worker-entry` chunks. Previously the prod
  build shipped no worker chunk and the REPL worker crashed on boot
  (`[worker error] undefined`) in any hosted build — invisible to CI, which
  only runs against `pnpm dev`.
- **Monaco language-service console spam.** New `src/glue/monaco-env.ts`
  wires `MonacoEnvironment.getWorker` (Vite `?worker` imports), removing the
  per-keystroke `toUrl` `TypeError` from the TS diagnostics adapter.
- **Editor ignored external source changes.** `EditorPanel` now reacts to
  `value` updates, so selecting a preset actually replaces the editor
  content.
- **Auto-run / Run could throw "Runtime is not running"** when fired before
  the worker booted — both now gate on `useRuntime.whenReady()`.

- **`npm install …` at the shell prompt (follow-ups item #15, 2026-05-27).**
  New glue file `apps/playground/src/glue/npm-shell-command.ts` registers
  an `npm` builtin on the long-lived `ShellSession` so typing
  `npm install express` in the terminal actually runs the installer
  instead of returning exit 127 ("command not found"). Supports
  `install` / `i` / `add` subcommands, plain `name`, `name@range`,
  scoped `@scope/name[@range]`, auto-creates a minimal `package.json`
  when the project has none, and merges new deps into existing ones.
  Bare `npm install` reads existing deps but does **not** rewrite
  `package.json`, so re-runs do not churn mtimes. Error mapping for
  `EVERSIONCONFLICT` / `EINTEGRITY` / `EBROKENLOCK` produces single
  operator-friendly stderr lines instead of stack traces. Flags
  (`--save-dev` etc.) are explicitly rejected as M9-scope. The
  `install` function is injected via a DI seam so the unit tests run
  without reaching across into another package's `_test-fixtures/`.
- **`ShellSession.registerCommand(name, cmd)` accessor.** Exposes the
  underlying `Shell.registerCommand` so composition-root glue can wire
  builtins (`npm`, future `node`) without `useShellSession` needing to
  know about them.

### Changed

- `adapters/useMode.ts` — extracted the `repl | dev | real-vite` mode state
  machine out of `App.tsx`. The new adapter owns the `mode` signal, the
  dev/real-vite handles, the real-vite port, and the editor source, and
  exposes `toggleDev` / `toggleRealVite` / `setSource` transitions that
  preserve the original branch-on-`mode()` semantics byte-for-byte. App.tsx
  shrinks to JSX + wiring (315 → 259 LOC; four signals + two transition
  branches moved into the adapter). Closes the P0 finding in the 2026-05-26
  playground audit ("App.tsx is a god-component juggling lifecycles the
  adapters should own").
- **ADR-0040:** the preview-bridge handshake stamped by
  `mountPlaygroundPreviewBridge()` now sends two version fields
  (`frameVersion`, `routingVersion`) instead of a single `version` field.
  The change is transitive — `setupPreviewBridge` from
  `@riftydev/service-worker` does the actual stamping; the playground
  wiring is untouched at the call site. A version mismatch on either
  contract surfaces as HTTP 503 from the SW the same way as before,
  with the warning now naming the drifted contract (`frame` or
  `routing`).

### Added

- Initial Solid UI scaffold: header + Monaco editor + xterm.js terminal in a 1:1 split, plus Run / Reset buttons.
- COOP/COEP headers in `vite.config.ts` (D-001) for cross-origin isolation, both in `server` and `preview` modes.
- Capabilities-detection fallback panel that explains which feature is missing if the browser isn't cross-origin-isolated.
- Service Worker registration on mount; failures surface in the terminal (red).
- `useRuntime` adapter as the single bridge between Solid signals and the framework-agnostic runtime controller (D-002).
- Dev proxy `/npm-registry → registry.npmjs.org` to make M9 wiring testable from day 1 (D-004).
- Runtime cross-origin-isolation guard (`assertCrossOriginIsolated` in `src/boot.ts`): if the page boots without `crossOriginIsolated === true`, paint an inline fatal banner and throw before any SAB-consuming code runs. Defence-in-depth for ADR-0002 in case COOP/COEP headers regress at the host.
- `bootstrapPlayground()` — single awaited pipeline in `src/boot.ts` that runs the COI guard, `initBackend()` (VFS), and `registerServiceWorker('/sw.js')` in order. `main.tsx` awaits it before `render(...)`, so the App always sees a fully-resolved boot bundle. Closes A-004 (REVIEW_ACTIONS): persistence wiring is in place, plus an e2e reload assertion in `tests/e2e/m0-boot.spec.ts`.

### Added

- `adapters/shell-adapter.ts` — `useShellSession()` hook that owns a
  long-lived `@riftydev/shell` `Shell` and forwards stdout/stderr to the
  terminal writer via the new `onChunk` callback. App.tsx consumes it in
  `dev` / `real-vite` modes so users can drive `npm install`, `vite dev`,
  file ops, and `&&`-chained commands from the terminal in real time.
  Closes Tier 0 finding 1 in the 2026-05-26 review (`@riftydev/shell` was
  declared as a dep but had zero consumers).
- `adapters/hmr-bridge.ts` — cross-realm HMR bridge (ADR-0017 phase 1
  acceptance). `setupHmrBridge({port})` hosts a `BridgedWebSocketServer`
  on `ws://preview.local:<port>/__hmr`; `createHmrBridgeVitePlugin({port})`
  injects a vanilla-JS `BroadcastChannel` client into the served
  `index.html` via `transformIndexHtml`; `realVite.ts` wires
  `server.watcher.on('change', ...)` to broadcast through the bridge.
  The iframe HMR client and Vite-side server now share the bridge's
  wire protocol — no native `WebSocket` involved, so HMR survives the
  page ↔ iframe realm boundary. Precursor to M11 A-026 (Vite-in-Worker):
  the migration becomes a realm swap, not a routing rewrite. Closes
  Tier 2 finding 9 in the 2026-05-26 review (`BridgedWebSocket` was
  built but had no callsites).
- `adapters/preview-bridge-wiring.ts` — `mountPlaygroundPreviewBridge()`
  extracts the byte-identical `setupPreviewBridge` handler that
  `devMode.ts` and `realVite.ts` each carried in-place. Closes the
  "Duplicated preview-bridge wiring" finding in the 2026-05-26
  architecture review (Appendix → playground).

### Changed

- `App` no longer races a `registerServiceWorker()` call in `onMount`. The SW is registered by `bootstrapPlayground()` before render; failures flow through `BootResult.swError` to the existing dismissible banner. Removes the small window where the REPL was interactive but the preview iframe was not yet routable.

### Fixed

- `SyncMirrorVfs.openReadable` now throws `NotImplementedError('SyncMirrorVfs.openReadable')` instead of a bare `Error` — surfaces the gap as a structured, catchable error per the CLAUDE.md "no silent stubs" hard rule. The path is preserved in the hint for diagnostics.
