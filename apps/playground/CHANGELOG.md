# Changelog

## [Unreleased]

### Changed

- **Netlify deploy automation.** GitHub Actions now deploys `main` to the
  production site and same-repo PRs to stable `pr-<number>` preview aliases;
  `netlify/functions/npm-registry.mts` carries the npm-registry proxy while
  `public/_redirects` keeps the SPA fallback in the built artifact.

- **ADR-0126 records the preview reload policy.** Preview iframe reloads are
  HMR-client-driven; the snapshot-driven `previewRevision`/`refreshKey` reload
  removed in the preview-routing branch is now ADR-recorded (options,
  rationale, stale-iframe trade-off). Docs/comments only; no behavior change.

- **"Soft Panels" visual redesign (ADR-0124).** UI rebuilt to the Gravity-UI
  design handoff: rounded card panels (`#1D1F26`) with 12px gaps on a
  `#131419` page, rifty lime `#C7F05A` accent, Inter (UI) + Roboto Mono
  (code/terminal) self-hosted variable fonts (latin + cyrillic). Top bar now
  hosts the template switcher (dropdown; replaces the activity bar + sidebar
  gallery, same e2e selectors), a LIVE/STARTING/STOPPED status pill, a ⌘K
  command bar, a GitHub link, and a Share button (copies the URL, success
  toast). Preview pane gained browser-frame chrome (address bar with editable
  port, phase pill, reload / open-in-tab). Monaco and xterm re-themed to the
  panel surface with handoff syntax colors; splitters now live invisibly in
  the panel gaps. Layout defaults follow the mockup (files 232 / terminal 212
  / preview 464).

### Fixed

- **Netlify npm registry proxy deploy.** CI and one-off Netlify deploy docs now
  run `netlify build` before artifact deploys so the function bundle and
  metadata stay in Netlify's build state; checked-in redirects now route
  `/npm-registry/*` to the production proxy before the SPA fallback. The
  function also falls back to `process.env.RIFTY_NPM_REGISTRY_UPSTREAM`, and
  deploys smoke-test `/npm-registry/vite` on the live URL.

- **Real Vite worker registers net/sqlite builtins through explicit calls.**
  Production bundling could drop side-effect-only imports and make Vite fail on
  `Built-in 'node:http' is not implemented`; the bootstrap now calls the
  idempotent `@riftydev/net` registrars directly.

### Added

- **Storage persistence + workspace archive.** Playground boot now probes
  `navigator.storage.persisted()` / `persist()` / `estimate()`, threads the
  result into the status badge, and exposes command-palette actions to
  download/import a dependency-free JSON workspace archive that excludes
  derived/heavy directories (`node_modules`, `.git`, `.vite`, `dist`).
- **Production npm registry proxy source.** Netlify routes `/npm-registry/*`
  to `netlify/functions/npm-registry.mts`, preserving metadata/tarball paths
  and adding CORS/CORP headers so the cross-origin isolated playground can use
  the same `/npm-registry` base outside dev.
- **Global command palette (⌘K / Ctrl-K).** Searches project templates,
  workspace files, and shell actions (new terminal, toggle terminal/files
  panels, open preview tab, stop dev server, copy share link). Modal dialog
  semantics with a focus trap, document-level Escape, focus restore on close,
  and keep-in-view arrow navigation. The hotkey is capture-phase and matches
  the physical key, so it works with Monaco/xterm focus and on non-Latin
  keyboard layouts.
- **Express + SQLite fullstack demo template (ADR-0130).** Second runnable
  project template (`node-server` runtime): real `express@4` installed from
  npm inside the worker, static client served from the VFS via
  `express.static`, `node:sqlite` (DatabaseSync over the sql.js WASM engine)
  as the database. New "Express + SQLite" preset in the gallery; covered by
  `tests/e2e/fullstack-demo.spec.ts` plus the opt-in
  `tests/integration/fullstack-demo-live-run.opt-in.test.ts`.
- **`ProjectSpec` is a discriminated union** (`vite` | `node-server`); the
  worker bootstrap dispatches on it — node servers run the ENTRY itself (cwd
  at project root, loud no-listen failure); HMR bridge + esbuild/rollup shims
  stay vite-only. sqlite engine bring-up uses an explicit `wasmBinary` +
  pinned `locateFile` from the bundled same-origin asset.
- **`RIFTY_PLAYGROUND_PORT` env** overrides the dev/e2e port (vite +
  playwright configs) so parallel git worktrees run side by side.

### Changed (migration)

- **Layout persistence key bumped to `rf.layout.v2`.** Old v1 sizes fit the
  pre-redesign shell, and a stale `sidebarCollapsed=true` from the removed
  activity bar would have hidden the files panel with no recovery UI; v1
  state is orphaned and defaults apply on first load.

### Changed (2026-06-11 design feedback)

- **Terminal Stop button removed.** Server state shows in the status pills;
  stopping goes through Ctrl-C in the terminal or the ⌘K palette ("Stop dev
  server"). Matches the handoff, which dropped the button.
- **Default terminal height raised to 280px** (mockup's 212px was too shallow
  for real logs).
- **Preview address copies the real URL.** The shown `localhost:<port>` host
  is virtual; clicking the address copies this origin's SW-routed
  `/preview/<port>/` URL with a toast. The URL serves only tabs the
  playground opens itself (`↗` button) — SW routing scopes a port to its
  owner window (backlog: `service-worker/cross-tab-preview-routing`).

### Fixed

- **Command palette opened pinned to the top-left corner.** `<dialog>` UA
  positioning (absolute + auto margins) escaped the flex centering; the panel
  is now statically positioned inside the scrim.
- **Editor code no longer collides with the right-edge ruler strip.** The
  overview ruler is disabled (minimap already off).
- **Terminal no longer flips to a light theme on light-OS machines.** The
  shell is dark-only; both `prefers-color-scheme` branches now resolve to the
  panel-surface xterm theme.
- **Undefined CSS variables in terminal overlays.** `--rf-ok` and
  `--rf-shadow-2` were referenced but never defined (block-rail / history
  exit-status colors and overlay shadows silently fell back); the token set
  now defines `--rf-ok` and real shadow tokens.
- **Real Vite editor writes are now checked through the real Monaco path.** The
  HMR e2e no longer uses a production-only source setter; it focuses Monaco's
  input, edits the visible model, then waits for the worker-applied write, an
  actual iframe HMR bridge `update` event, and the iframe update. The parent
  preview panel no longer reloads the iframe for every worker VFS snapshot, so
  the e2e cannot pass via explorer refresh alone.
- **Real Vite HMR invalidates by Vite file-change semantics.** Worker-side
  writes now call `moduleGraph.onFileChange(file)` instead of probing
  `getModuleById(file)` and falling back to `invalidateAll()`.
- **HMR bridge channels are per-server tokenized.** The iframe client and bridge
  server share a nonce-scoped URL/channel, so unrelated same-origin code cannot
  join the old predictable port-only HMR channel.
- **Cross-origin isolation failures now explain embedded-browser requirements.**
  The fatal COI guard still refuses to boot without `crossOriginIsolated === true`,
  but the message now calls out iframe/app-browser embeds: the parent page must
  also be cross-origin isolated and the iframe must include
  `allow="cross-origin-isolated"`.
- **`preset.templateId` wired (ADR-0130).** App follows the selected preset's
  template (reactive `activeTemplate()`) instead of always booting the
  registry default; boot line is template-dispatched (`terminalDevLine`:
  `vite` | `npm run dev`), `npm run dev` routes the template's dev script to
  the lifecycle-owning dev-server command, `vite` refuses non-vite templates
  with a hint; spawn env gains Node-idiomatic `PORT`.
- **sql.js pre-bundled** (`optimizeDeps.include`) — lazy CJS discovery from
  the worker chunk made dev Vite re-optimize and full-reload the page
  mid-session, dropping the selected preset and running dev server.
- **Project presets now open starter editor tabs.** File-oriented presets open
  two seeded files beside `src/main.js` as inactive tabs, so users see the tab
  strip immediately while the entry file remains active.
- **Terminal tabs now keep the add button attached to the tab strip.** The
  bottom-console tab list no longer stretches across the whole toolbar before
  the `+` action, so the new-terminal control stays visually glued to the
  terminal tabs while remaining visible when the tab list overflows.
- **Terminal tab switching is regression-covered end-to-end.** Playwright now
  switches Terminal 2 → Terminal 1 → Terminal 2 and asserts the active buffer
  changes with the selected tab.
- **Idle terminal tabs close cleanly.** Closing a newly created terminal no
  longer lets an xterm WebGL teardown exception interrupt Solid's DOM update;
  the console returns to the running terminal with a single active panel.
- **`npm run vite` works in the playground shell.** The seeded Vite project now
  exposes both `dev` and `vite` scripts, and the playground `npm run <script>`
  path routes `vite` scripts through the same visible terminal command that owns
  the real Vite worker lifecycle.
- **Ctrl+C now reaches the shell through the bottom console.** `BottomPanel`
  declared `onSignal` but dropped it before `TerminalPanel`, so the terminal
  echoed `^C` while the playground shell never received `interrupt()`. The
  prop is now forwarded to the mounted xterm wrapper.
- **Terminal command status now reaches xterm markers.** Shell-mode `runLine()`
  returns its exit code through `BottomPanel`/`TerminalPanel` into
  `RiftyTerminal`, so command blocks can show success/failure decorations.
- **Terminal tab completion is wired in shell modes.** The playground now feeds
  `RiftyTerminal` completions from `Shell.commandNames()` at argv-0 and from the
  main-thread VFS for path arguments.
- **Terminal follows OS light/dark preference.** The xterm wrapper now starts
  with a terminal theme derived from `prefers-color-scheme` and updates it via
  `setTheme()` on OS theme changes. The broader playground CSS light theme
  remains its parked backlog item.
- **Terminal find overlay.** Ctrl/Cmd+F inside the console opens a compact find
  box backed by `RiftyTerminal.findNext()` / `findPrevious()`; Enter and
  Shift+Enter walk matches, Esc closes and clears decorations.
- **Terminal command palette.** Ctrl/Cmd+Shift+P inside the console opens a
  command picker seeded from `Shell.commandNames()`; selecting a command
  pre-fills the terminal through `RiftyTerminal.replaceLine()`.
- **Terminal quick fix for command typos.** Shell stderr `Did you mean 'cmd'?`
  diagnostics now surface a console action that runs the suggested command via
  `RiftyTerminal.submitLine()`.
- **Terminal quick fixes are provider-based.** The quick-fix glue now supports
  multiple output providers; `EADDRINUSE` / address-in-use diagnostics offer a
  stop-and-rerun action for the last submitted command.
- **Terminal sticky command header.** The console now pins the command block at
  the top of the xterm viewport and lets you click it to jump back to that
  command.
- **Terminal command-block rail.** Recent command blocks now show as a compact
  status rail in the console; clicking a mark jumps to that block, and the
  sticky command header has an icon action to copy the current block output.
- **Terminal rich history overlay.** Ctrl/Cmd+R inside the console opens a DOM
  history picker backed by rich records (command, cwd, mode, duration, exit
  code, session id) saved through the terminal persistence store; selecting a
  row restores the command line.
- **Terminal state persistence.** The playground now restores shell `cwd` and
  env from `/workspace/.rifty/terminal-state.json` before constructing the shell
  session, then saves updated state after each submitted terminal line. Async
  OPFS is used when available; memory fallback remains session-only.
- **Shell abbreviations/snippets.** Shell-mode terminal input now seeds
  fish-style rewrite rules for `ll -> ls -la`, `la -> ls -a`, and
  `mk -> mkdir -p`.
- **AI command suggestions.** When `VITE_RIFTY_AI_COMMAND_SUGGEST_URL` is set,
  shell-mode `# prompt` lines request a command suggestion, render it as ghost
  text, and accept it by replacement only. Suggestions are filtered to rifty
  coreutils, reject compound shell syntax, and never auto-run; raw `# prompt`
  Enter is a no-op.
- **Background jobs.** Shell-mode `cmd &` now returns the prompt immediately,
  streams background output into the terminal without corrupting the editable
  line, and exposes status through the `jobs` builtin.
- **Terminal raw stdin.** Shell-mode foreground commands now receive terminal
  raw input while running, enabling `mouse-demo` to verify xterm mouse reports
  through the browser.
- **Terminal e2e renderer.** Automated browsers disable the WebGL addon via
  `navigator.webdriver`, keeping xterm's DOM rows available for Playwright
  assertions while normal sessions keep best-effort WebGL.
- **Terminal output export.** The terminal command palette now includes actions
  to copy text output, copy HTML output, and download the serialized scrollback
  as a standalone HTML document.
- **Terminal OSC 8 file links.** Ctrl/Cmd-clicking a `grep` file hyperlink opens
  safe `file:///workspace/...` targets in the editor; non-file, outside-workspace,
  and traversal links are ignored.
- **Shell command-line syntax highlighting.** Shell-mode terminal input now
  colors command words, quoted strings, and shell operators through the
  `@riftydev/terminal` highlighter seam.
- **Shell multiline input.** Shell-mode Enter now keeps editing when quotes,
  bracket groups, or trailing continuations are incomplete; the completed raw
  multiline buffer is submitted as one command.
- **Terminal autocomplete dropdown.** Tab or Ctrl/Cmd+Space inside the console now
  opens a keyboardable DOM completion list backed by the existing shell
  command/path completer; ArrowUp/Down selects, Enter/Tab applies, Esc closes.
- **Real Vite browser e2e covers the full opt-in path.** The `RIFTY_E2E_HMR=1`
  Playwright flow now drives the cross-origin-isolated path: boot Vite in the
  worker realm, render the iframe through SW preview routing, edit `src/main.js`
  through Monaco, write it into the worker VFS, invalidate Vite's module graph,
  and reload the iframe through the cross-realm HMR bridge. The backlog stays
  open until this path has a default or CI verification lane.
- **Terminal no longer overlaps the status bar.** xterm's `FitAddon` computes
  rows from the mount element's height minus *that element's own* padding (the
  `.xterm` div it creates, padding 0) — so the `6px` vertical padding on the
  `.rf-terminal` mount container was never subtracted and the bottom row
  overflowed ~6px past the console body into the status bar. Moved the gap from
  `padding` to `inset` on `.rf-terminal` (+ `--rf-bg-1` on `.rf-console__body`
  so the inset gap stays the xterm surface colour); FitAddon now fits the
  trimmed box. Verified live: 9px clearance above the status bar.
- **Dev-mode preview is now live (HMR auto-reload).** Editing a file in dev
  mode left the preview frozen until a manual page reload: the mini dev server
  (`examples/vite-like-dev`) broadcast HMR over an in-process `WebSocketServer`
  that the preview iframe — a separate realm reached via the SW — can never
  reach. Dev mode now routes HMR through the same cross-realm `BroadcastChannel`
  bridge real-Vite uses: the example dev server gained a pluggable `hmr`
  transport, and `startDevMode` wires `setupHmrBridge` + injects
  `hmrClientScript` into served HTML. Closes the dev-vs-real-Vite HMR asymmetry.
  Verified live: editor edit → watcher → bridge → iframe auto-reloads with the
  new content.
- **Rich-terminal capabilities were dead in the real app — now wired.** The shell
  adapter forwarded none of `isTTY`/`cols`/`rows`/`signal`, so `ls` column layout +
  `--color` never engaged and Ctrl+C never reached the shell. `useShellSession.runLine`
  now passes `isTTY:true` + live `cols`/`rows` (from xterm via `RiftyTerminal`) + a
  per-run `AbortController`; new `interrupt()` is wired to the terminal's `onSignal`
  (Ctrl+C → SIGINT → a running `sleep`/dev-server winds down, exit 130). Threaded
  `onSignal` + dimensions through `BottomPanel`/`TerminalPanel`/`App`. Review pass 2026-06-07.

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
- **Real Vite preview now owns its Service Worker route directly (ADR-0123).**
  The Real Vite page and Worker share a preview `ownerToken`; the Worker mounts
  `setupPreviewBridge(..., { ownerToken, ports: [port] })`, so the SW can route
  `/preview/<port>/...` straight to the matching Worker-owned Vite server. The
  page-side cross-realm preview proxy remains as a compatibility fallback for
  legacy window-owned paths and old-SW/new-page skew.
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

- **e2e-gated execSync-over-SAB harness (`#test=execsync`).** A page-realm harness (`src/execsync-harness.ts`) + guest worker entry (`src/workers/execsync-harness-guest.ts`) that proves rifty's real `execSync` path end-to-end in a cross-origin-isolated chromium Worker — the path Node tests cannot exercise (real SharedArrayBuffer + `Atomics.waitAsync` dispatcher wake + ADR-0084 v2 binary frame; the conformance SAB-blocking cases `skipIf(!sabReady)` in Node). `main.tsx` runs it ONLY when `location.hash` includes `test=execsync` (lazy-imported chunk); normal boot is byte-unchanged. The page realm (which owns the kernel dispatcher) seeds the child scripts into its sync mirror, registers the runtime-js `'execSync'` handler on `getKernelDispatcher()` (via the new `@riftydev/runtime-js/ipc/exec-sync-handler` seam), and `spawnWorker`s a guest that runs `execSync('node /child.js')` where the child writes raw non-UTF-8 bytes `[0xff,0xfe,0x00]`; the guest emits the result hex into the DOM. Asserted by `tests/e2e/execsync-sab.spec.ts`: `hex === 'fffe00'` (a broken v2 frame mangles to U+FFFD → `efbfbd...`; a broken dispatcher hangs → timeout — only the real byte-exact round-trip passes) plus a `blocked-result` blocking round-trip. This harness surfaced the kernel SAB JSON-frame `TextDecoder`-on-shared-view bug (fixed in `@riftydev/kernel`).

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
  `machine.source`/`setSource` (initial JS runner + dev/real-vite HMR unchanged)
  under a single `suppressProgramEcho` guard; files opened from the explorer get
  their own model with debounced VFS write-back. `monaco-env` gains the json /
  css / html language workers.
- **Preset gallery — click-to-run examples (ADR-0073).** New `src/presets.ts`
  + `src/components/PresetGallery.tsx`: a category-grouped left rail of
  example programs (Welcome, Event-loop order, Node core modules, Virtual
  filesystem, Dev server + HMR, Real Vite + npm). Selecting a preset loads
  its source and switches mode; JS-runner presets auto-run. Every preset is
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
  loading transitions modes; JS-runner eval gates on worker readiness.

### Fixed

- **Production runtime worker never loaded (ADR-0073).** `useRuntime.ts` and
  `main.tsx` now import the worker entries via `?worker&url` instead of
  `new URL(..., import.meta.url)`, so `vite build` actually emits + bundles
  the `worker-entry` / `kernel-worker-entry` chunks. Previously the prod
  build shipped no worker chunk and the runtime worker crashed on boot
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

- `App` no longer races a `registerServiceWorker()` call in `onMount`. The SW is registered by `bootstrapPlayground()` before render; failures flow through `BootResult.swError` to the existing dismissible banner. Removes the small window where the JS runner was interactive but the preview iframe was not yet routable.

### Fixed

- `SyncMirrorVfs.openReadable` now throws `NotImplementedError('SyncMirrorVfs.openReadable')` instead of a bare `Error` — surfaces the gap as a structured, catchable error per the CLAUDE.md "no silent stubs" hard rule. The path is preserved in the hint for diagnostics.
