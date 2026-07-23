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
| Detached `fetch()` / network keepalive | ✅ | The global `fetch` is keepalive-counted: ref on dispatch, held until the response BODY is consumed (Node keeps the socket refed until the body is read). `http.request` to an external host routes through `fetch` (covered); loopback `http.request` is in-process (no socket); `https`/`net.connect` are loud-throws. A never-consumed body holds the realm to the drain cap (loud). ADR-0158 |
| `fs.watch` / `fs.watchFile` keepalive | ✅ | The poll `setInterval` is keepalive-counted; `FSWatcher.ref()`/`.unref()` opt the realm in/out via the poll handle (Node parity) — an unrefed watcher no longer holds the realm to the drain cap |
| Timer `.unref()` / `.ref()` / `.hasRef()` | ✅ | `setTimeout`/`setInterval` handles can opt out of and back into keepalive; `node:timers` uses the same wrapper as globals |
| `process.exit(N)` propagates the exit code | ✅ | Via the `RIFTY_PROCESS_EXIT` shape (ADR-0039) |

## Terminal `node <file>` command (ADR-0155)

The playground terminal runs an arbitrary entry as a supervised child of the workspace owner
(the `.bin`/`runNodeEntry` seam, ADR-0137 — NOT the template dev-server). Server-vs-script is
decided by what the program DOES (it called `listen()`), not a flag — Node-faithful. Backing tests:
`tests/e2e/node-command.spec.ts`, `packages/workbench/src/workers/node-program-lifecycle.test.ts`,
`packages/workbench/src/workers/owner-child-node-executor.test.ts`,
`packages/workbench/src/workers/workbench-project-runtime.test.ts`,
`packages/workbench/src/workers/preview-registry.test.ts`, and
`tests/browser-unit/owner-node-stdio-control.spec.ts`. Run-to-completion loader parity (shebang,
relative `import`/`require`, exit codes) reuses the existing node-entry/resolver conformance
(`packages/runtime-js/src/builtins/node-entry.test.ts`, `tests/conformance/modules/resolver.test.ts`,
`tests/conformance/builtins/child_process.test.ts`) — `node <file>` is the second consumer of an
unchanged loader, so it adds no duplicate parity case.

| Feature | Status | Notes |
|---|---|---|
| `node <file> [args]` run-to-completion | ✅ | Streams stdout/stderr; exits on event-loop drain (the model above) with the program's code; Ctrl-C → exit 130 |
| Legacy Playground `node -e/-p` eval context | ⚠️ | Executes a temporary `.cjs`, so argv, `[eval]` filename/module identity, and `require.main` differ from Node 24. See `backlog/runtime-js/node-cli-eval-identity-parity`. |
| Workbench `node -e/-p` eval context | ❌ | Throws `NotImplementedError('workbench.node.eval-context')` rather than repeat the legacy temporary-file approximation. Same backlog. |
| `node <server.js>` long-running server | ✅ | A `listen()` keeps the child alive (`serve:true`); the listened port is registered for preview; Ctrl-C stops it |
| Multi-port preview + switcher | ✅ | Each live server (and `npm run dev`) appears in the preview-panel port switcher; routed via `/preview/<port>/` |
| `Error: Cannot find module` for a missing entry (real Node `MODULE_NOT_FOUND`) | ✅ | `node ./nope.js` / `./nope.mjs` emits real Node's multi-line `Error: Cannot find module '<abs>'` + `{ code: 'MODULE_NOT_FOUND', requireStack: [] }`, exit 1 — the loader is the single producer (the owner no longer pre-checks existence), and Node runs a missing entry through its CJS loader for both extensions. The error OBJECT (`err.code` + `err.requireStack` + the `Cannot find module … Require stack:` message) is parity-proven head-to-head for a nested `require()` miss (`tools/node-parity-runner/cases/modules/module-not-found.case.ts`). Honest deltas in the PRINTED form: ALL stack frames are dropped (the `node:internal/…` loader frames have no in-browser equivalent + are version-specific; rifty also doesn't synthesize the user call-site frame Node interleaves on a nested miss), the `Node.js vX` trailer is omitted, `requireStack` uses Node's inline inspect form (long paths don't multi-line-wrap), and a deeper ancestor chain collapses to the immediate requirer. A nested ESM `import()` miss is a DIFFERENT Node error (`ERR_MODULE_NOT_FOUND`) — rifty surfaces an honest non-masquerading `ModuleLoadError` there, not yet that shape: `backlog/runtime-js/esm-import-miss-err-module-not-found` |
| Flowing stdin (`process.stdin.on('data')`) | ⚠️ | The session forwards ordered bytes and explicit EOF to supervised Node/`.bin` children. `pause()`/`resume()`, UTF-8 `setEncoding()`, split-codepoint decoding, and one ordered `end` are real (ADR-0230). Other encodings, pull/readable APIs (`on('readable')`, `read`, `pipe`, async iteration), and raw mode/line discipline remain loud `NotImplementedError` gaps; this is not full `readline`/raw-PTY support. |
| TTY dimensions + live resize | ✅ | Initial `columns`/`rows` and `getWindowSize()` match the run grid. A live xterm resize reaches the same child after logical IPC disconnect, updates stdout/stderr, emits their `resize` events, then `SIGWINCH` in Node order (ADR-0225; real OS-PTY parity + Chromium worker proof). |
| `node x.js &` (trailing background) | ✅ | Runs in a background job via the shell's generic trailing-`&` path; job-control builtins (`jobs`/`fg`/`bg`) are the gap — `backlog/shell/background-job-model` |
| `node:sqlite` (`DatabaseSync`) in a bare `node <file>` | ✅ | Registered for every `node <file>` run; the sql.js engine comes up SYNCHRONOUSLY at the first `require('node:sqlite')` via the realm-installed wasm-bytes provider (no preset flag, no eager 30 s boot — preset-deglue epic) |
| A bare node server reachable from ANOTHER child (loopback) | ❌ | Reachable via `/preview/<port>/` only; cross-realm HTTP loopback is `backlog/net/cross-realm-http-loopback` |

## Known limitations

- The drain cap uses wall-clock (`performance.now()`), so a CPU-busy worker could in principle trip
  the 30 s cap; the cap is generous, so the risk is low.
- The keepalive model is honestly the count of timers/immediates/pending imports + global `fetch`
  + `fs.watch` polls — NOT the full libuv handle set. The reachable network/timer/import surface is
  now covered (rows above); other libuv handle classes are not browser-reachable. ADR-0152 §1 (set
  shape) + ADR-0158 (fetch added).
