# Changelog

## [Unreleased]

### Added

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
  `@rifty/service-worker` does the actual stamping; the playground
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
  long-lived `@rifty/shell` `Shell` and forwards stdout/stderr to the
  terminal writer via the new `onChunk` callback. App.tsx consumes it in
  `dev` / `real-vite` modes so users can drive `npm install`, `vite dev`,
  file ops, and `&&`-chained commands from the terminal in real time.
  Closes Tier 0 finding 1 in the 2026-05-26 review (`@rifty/shell` was
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
  "Дублированный preview-bridge wiring" finding in the 2026-05-26
  architecture review (Приложение → playground).

### Changed

- `App` no longer races a `registerServiceWorker()` call in `onMount`. The SW is registered by `bootstrapPlayground()` before render; failures flow through `BootResult.swError` to the existing dismissible banner. Removes the small window where the REPL was interactive but the preview iframe was not yet routable.

### Fixed

- `SyncMirrorVfs.openReadable` now throws `NotImplementedError('SyncMirrorVfs.openReadable')` instead of a bare `Error` — surfaces the gap as a structured, catchable error per the CLAUDE.md "no silent stubs" hard rule. The path is preserved in the hint for diagnostics.
