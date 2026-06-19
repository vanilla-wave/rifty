# Compatibility matrix — Process lifecycle & event loop

Hand-maintained (the `pnpm compat:generate` data-driven sink isn't wired yet). Update by hand after
touching the child-realm drain / keepalive code. Covers how a rifty child process exits — the
event-loop drain model (ADR-0152) and its one deliberate, loud divergence from Node.

A run-to-completion child (`serve` absent/false) exits when its event loop DRAINS (no live refed
handle), like real Node — not at top-level resolve. A long-lived server uses `serve:true` and is
never drain-reaped (kept alive by its own ports). Backing tests:
`tests/e2e/owner-shell-async-lifecycle.spec.ts`, `packages/kernel/tests/worker-entry-drain.test.ts`,
`packages/runtime-js/src/module-loader/loader-keepalive.test.ts`.

| Feature | Status | Notes |
|---|---|---|
| Exit on event-loop drain (not top-level resolve) | ✅ | Post-top-level async (timers, detached `import().then(run)`) completes before reap |
| Keepalive counts `setTimeout`/`setInterval` | ✅ | libuv-style refcount; loop stays alive while a refed timer exists |
| Keepalive counts `setImmediate` | ✅ | |
| Keepalive counts pending dynamic `import()` | ✅ | Both `loader.import` and routed user-code `import()` (`__import`) |
| `unhandledrejection` → stderr + non-zero exit | ✅ | Record-not-swallow; never silent `exit 0`. Node parity (default warn + non-zero) |
| **Drain cap: a refed loop that never drains is force-killed** | ⚠️ | **Deliberate non-Node divergence.** At 30 s the worker exits 1 + a self-explanatory stderr line, where Node runs forever. Browser-worker safety-net against a genuine hang/leak — generous + loud. Legit-forever programs use `serve:true` (the cap never fires there). See ADR-0152 §4 |
| Detached `fetch()` / network keepalive | ❌ | NOT counted — network in flight after top-level can be reaped early. `backlog/runtime-js/timer-unref-keepalive` (network path) |
| `fs.watch` / `fs.watchFile` keepalive | ⚠️ | The poll `setInterval` IS counted → an active watcher with no `.unref()` force-exits at the cap, where Node runs forever |
| Timer `.unref()` / `.ref()` / `.hasRef()` | ❌ | Not implemented → an `.unref()`'d timer can't opt out of keepalive (drains to cap). `backlog/runtime-js/timer-unref-keepalive` |
| `process.exit(N)` propagates the exit code | ✅ | Via the `RIFTY_PROCESS_EXIT` shape (ADR-0039) |

## Terminal `node <file>` command (ADR-0154)

The playground terminal runs an arbitrary entry as a supervised child of the workspace owner
(the `.bin`/`runNodeEntry` seam, ADR-0137 — NOT the template dev-server). Server-vs-script is
decided by what the program DOES (it called `listen()`), not a flag — Node-faithful. Backing tests:
`tests/e2e/node-command.spec.ts`, `apps/playground/src/workers/node-program-lifecycle.test.ts`,
`apps/playground/src/workers/owner-child-node-executor.test.ts`,
`apps/playground/src/workers/preview-registry.test.ts`. Run-to-completion loader parity (shebang,
relative `import`/`require`, exit codes) reuses the existing node-entry/resolver conformance
(`packages/runtime-js/src/builtins/node-entry.test.ts`, `tests/conformance/modules/resolver.test.ts`,
`tests/conformance/builtins/child_process.test.ts`) — `node <file>` is the second consumer of an
unchanged loader, so it adds no duplicate parity case.

| Feature | Status | Notes |
|---|---|---|
| `node <file> [args]` run-to-completion | ✅ | Streams stdout/stderr; exits on event-loop drain (the model above) with the program's code; Ctrl-C → exit 130 |
| `node <server.js>` long-running server | ✅ | A `listen()` keeps the child alive (`serve:true`); the listened port is registered for preview; Ctrl-C stops it |
| Multi-port preview + switcher | ✅ | Each live server (and `npm run dev`) appears in the preview-panel port switcher; routed via `/preview/<port>/` |
| `node: cannot find module` for a missing entry | ⚠️ | INTENTIONAL simplified single-line `node: cannot find module '<abs>'` + exit 1, resolved against the owner store (not a raw worker throw). NOT byte-faithful to real Node's multi-line `Error: Cannot find module … { code: 'MODULE_NOT_FOUND', requireStack: [] }`. Real-Node shape via the loader: `backlog/runtime-js/node-entry-miss-node-shape` |
| Interactive stdin (`readline` / `process.stdin`) | ❌ | The session's stdin is NOT forwarded to the child; the seeded `process.stdin`'s consume surface (`on('data')`/`on('readable')`/`once`/`addListener`/`read`/`resume`/`setEncoding`/`setRawMode`/`pipe`/async-iter) throws `NotImplementedError` — loud, never a silent hang. `pause()`/`'end'`/`isTTY` stay passive (a defensive `pause()` lets a non-reading program exit, like Node). `backlog/kernel/worker-per-process-residuals` (+ `backlog/terminal/raw-stdin-deferred-items`) |
| `node x.js &` (trailing background) | ✅ | Runs in a background job via the shell's generic trailing-`&` path; job-control builtins (`jobs`/`fg`/`bg`) are the gap — `backlog/shell/background-job-model` |
| `node:sqlite` (`DatabaseSync`) in a bare `node <file>` | ❌ | The 30 s WASM engine is brought up eagerly only for the template path (`cfg.sqlite`); a bare-node lazy bring-up is deferred + loud. `backlog/net/node-bare-sqlite-lazy-bringup` |
| A bare node server reachable from ANOTHER child (loopback) | ❌ | Reachable via `/preview/<port>/` only; cross-realm HTTP loopback is `backlog/net/cross-realm-http-loopback` |

## Known limitations

- The drain cap uses wall-clock (`performance.now()`), so a CPU-busy worker could in principle trip
  the 30 s cap; the cap is generous, so the risk is low.
- The keepalive model is honestly the count of timers/immediates/pending imports — NOT the full
  libuv handle set (see the `fetch`/`fs.watch`/`.unref()` rows above and ADR-0152 "Explicit gaps").
