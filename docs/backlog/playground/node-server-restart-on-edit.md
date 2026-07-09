---
area: playground
status: ready
title: Node-server templates do not restart on entry edits (no nodemon equivalent)
created: 2026-06-12
why: editing src/main.js updates the owner VFS but the running Express, Hono, or Koa server keeps executing the module loaded at boot
user_story: As a developer editing an Express, Hono, or Koa starter, I want `npm run dev` to use real nodemon so source edits restart the app on the same preview port, but today I must stop and rerun the server manually.
blocked_by: [runtime-js/generic-spawn-worker-remote-fs]
sources: [ADR-0130, ADR-0202]
code: [apps/playground/src/templates/project-spec.ts, apps/playground/src/workers/node-server-runner.ts, apps/playground/src/workers/real-vite-bootstrap.ts, tests/e2e/fullstack-demo.spec.ts, tests/e2e/hono-api.spec.ts, tests/e2e/koa-api.spec.ts]
---

## Context

Vite templates reload through their HMR bridge. Node-server templates instead import their entry once, so later owner-VFS writes do not affect the running module realm. A custom watcher or synthetic “restarted” log would not establish Node compatibility: the forcing consumer is the installed real `nodemon` package, including its child-process, filesystem-watch, stdio, crash-recovery, and teardown behavior.

The server must restart in a fresh Worker because module cache and in-memory application state belong to the old realm. That Worker must reuse the same preview port only after the old realm releases its network registry and preview responder.

## User scenario

A developer selects the Express + SQLite Starter. After installation, the playground runs:

`npm run dev` → `nodemon --legacy-watch --no-stdin --no-update-notifier src/main.js`

The developer adds a top-level marker to `/scratch/src/main.js`. They see nodemon’s own restart message, the marker from a fresh app process, and the existing preview port serving the edited program. Express’s in-memory SQLite data returns to its seed state, proving the old realm died. If the edit contains invalid syntax, the terminal shows the real crash; replacing it with valid source restarts successfully without rerunning `npm run dev`. Ctrl-C or selecting another Starter leaves the old preview route unavailable.

The same edit/restart behavior applies to the Hono and Koa Starters.

## Acceptance

1. Express, Hono, and Koa pin `nodemon@3.1.14` in `devDependencies`.
2. Their generated `dev` script is exactly `nodemon --legacy-watch --no-stdin --no-update-notifier src/main.js`; `start` remains `node src/main.js`.
3. The dev-server realm resolves and executes the installed `node_modules/.bin/nodemon` through the real module loader. There is no built-in watcher or direct-node substitution.
4. Readiness requires a real cross-realm HTTP response from the app child. A log line or process-spawn event alone cannot publish the preview as ready.
5. An editor, terminal, or file-tree write under the active project reaches the owner VFS and becomes visible to nodemon’s real watcher.
6. A single source edit prints nodemon’s restart output, terminates the prior app Worker, starts a fresh Worker, and serves the edited bytes on the same port without `EADDRINUSE`.
7. Restart resets realm-local state. Express SQLite, Hono message state, and Koa note state return to their template seed state.
8. Multiple writes inside nodemon’s debounce window may coalesce, but execution converges on the final bytes with one live app owner and no stale port holder.
9. Invalid source reaches inherited stderr and produces nodemon’s app-crashed state. A later valid edit recovers without manually restarting the watcher.
10. Ctrl-C and project switching terminate both nodemon and its app Worker. A pending filesystem event cannot resurrect either process or the old preview route.
11. A missing or broken installed nodemon launcher propagates the real loader failure. It never falls back to direct `node`.
12. Direct-node project specs without `devRunner: 'nodemon'` retain their existing import/listen path.
13. Playground CHANGELOG and process compatibility claims name the real nodemon path and its bounded child-process gaps.

## Parity cases

Run the same pinned command under Node 24.16.0 and rifty, with equivalent project files:

1. Initial start: nodemon launches `node src/main.js`; application stdout/stderr reaches the supervising terminal and the configured port serves.
2. Single watched edit: nodemon prints its restart line, replaces the app process, executes the new top-level marker, and reuses the same port.
3. Realm reset: state created before the edit is absent after restart while immutable seed data is recreated.
4. Rapid edits: exact restart count is timing-dependent, but both runs converge on the final file contents without two live children or `EADDRINUSE`.
5. Syntax failure: invalid ESM source reaches stderr, nodemon remains watching, and a later valid replacement starts successfully.
6. Signal teardown: Ctrl-C stops the watcher and descendant; no later watched event restarts the app.
7. Missing launcher: resolving the absent installed nodemon bin fails loudly before readiness; no alternative server path starts.
8. Express, Hono, and Koa each run the same nodemon argument contract and complete at least one same-port edit restart.

## Fault matrix

| Axis × operation | Injected fault | Honest outcome and fault-test target |
|---|---|---|
| `unbounded-read` × readiness probe | Cross-realm HTTP request never responds | Destroy the request at the 10 s probe bound and reject readiness with the port-specific timeout; never wait forever or publish LIVE. |
| `provenance-lie` × readiness | Nodemon/app logs appear but no app response crosses the preview bridge | Keep preview unready until a real HTTP response arrives; logs cannot fabricate readiness. |
| `false-fallback` × launcher resolution | Installed `.bin/nodemon` is absent or fails to load | Propagate the loader error; do not import `src/main.js` directly and do not claim nodemon is running. |
| `concurrent-same-key` × rapid source edits | Two writes land inside nodemon’s debounce/restart window | Allow coalescing, but converge on final bytes with one app Worker, one port owner, and no stale responder. |
| `torn-state` × app restart | Old app exits or crashes after releasing only part of its runtime state | The whole Worker realm and preview responder are torn down; a successful replacement starts cleanly or the watcher remains visibly crashed. Never retain mixed old/new state. |
| `observable-order` × teardown versus pending restart | Ctrl-C or project switch races a queued watcher event | Teardown wins: await watcher/app exit and port release; the queued event cannot respawn after closure. |
| `sibling-drift` × curated server templates | One of Express/Hono/Koa acquires different nodemon version or arguments | One project-spec argument boundary pins all three; per-template tests and E2E assert the shared command and restart behavior. |

## Out of scope

- Interactive input to the nodemon supervisor is not claimed; curated scripts pass `--no-stdin`. The separate terminal `node <file>` consume path remains compat ❌ and throws `NotImplementedError('process.stdin')`.
- Worker stdio modes `'ignore'`, `'overlapped'`, numeric descriptors, plain-spawn `'ipc'`, IPC at fd 0–2, and non-IPC fd 3+ entries remain compat ❌ through `NotImplementedError('child_process.spawn.stdio')`.
- Node advanced IPC serialization remains compat ❌ through `NotImplementedError('child_process.serialization.advanced')`.
- `process.channel.ref()` / `unref()` and `subprocess.channel.ref()` / `unref()` remain compat ❌ through the four directed `process.channel.*` and `child_process.channel.*` `NotImplementedError` features.
- Arbitrary native executables, OS process groups, and process-table formats beyond bare `ps` and `ps -A -o ppid,pid` are not claimed. Unsupported known `ps` formats throw `NotImplementedError('child_process.ps-format')`; unknown executables retain ENOENT/127.
- Vite, Socket Lab, and Markdown SSG keep their existing development runtimes; this item does not route them through nodemon.

## Decisions

- ADR-0202 is the governing irreversible decision.
- Use the installed real `nodemon@3.1.14`; never implement a playground-owned watcher or synthetic restart path.
- Readiness is a real cross-realm HTTP response, not a terminal marker.
- Each restart replaces the whole app Worker; module cache and in-memory state are deliberately not preserved.
- Nodemon owns debounce behavior. Rifty guarantees final-byte convergence and single port ownership, not an invented fixed restart count.
- The generic remote-FS Worker child contract is supplied by `runtime-js/generic-spawn-worker-remote-fs`; this item does not duplicate that transport.

## Reversibility

IRREVERSIBLE — changes the user-visible Starter dependency/runtime contract, selects the real nodemon lifecycle, and depends on public child-process behavior. Governed by ADR-0202.
