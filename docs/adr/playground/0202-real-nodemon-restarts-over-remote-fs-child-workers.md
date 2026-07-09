# ADR 0202: Real nodemon restarts over remote-FS child workers

Status: Accepted
Date: 2026-07

> TL;DR: Express, Hono, and Koa run the pinned real `nodemon` CLI; its app child is a supervised remote-FS Worker, never an in-realm approximation.

## Context

Node-server dev scripts were intercepted and their entry imported once. Adding a
`nodemon` dependency or changing `package.json` alone would therefore be a false
claim. Running the CLI exposes the older, deliberately loud
`child_process.spawn[worker]` gap: a nested Node worker needs the same owner VFS,
server lifetime, stdio inheritance, and deterministic teardown on restart.

## Decision

1. Express, Hono, and Koa pin `nodemon@3.1.14` in `devDependencies`. Their
   `dev` script is `nodemon --legacy-watch --no-stdin --no-update-notifier
   src/main.js`; `start` remains `node src/main.js`. Other node-server templates
   keep direct Node execution.
2. The supervised dev-server realm executes that installed `.bin/nodemon`
   through the runtime module loader. Readiness is the first real cross-realm
   HTTP response from the app child, not a fabricated log marker.
3. Generic `spawn('node', …)` / `fork()` uses a node-entry Worker only when the
   current kernel dispatcher is registered as an `fs.*` relay. The child gets
   `RIFTY_REMOTE_FS=1`; a server-capable fork also gets `RIFTY_NODE_SERVE=1`.
   Realms without that capability retain the loud `NotImplementedError`.
4. Worker-child stdout/stderr honor writable `stdio` targets, so nodemon's
   inherited streams reach the terminal. The browser process table implements
   the `ps -A -o ppid,pid` subset from real kernel records; this lets
   `pstree.remy` observe that the direct app worker has no descendants instead
   of installing an always-empty fake shim.
5. Killing the app terminates its Worker realm. The realm owns its net registry
   and preview responder, so the port is released before nodemon starts the next
   child. Rapid edits converge through nodemon's own watcher/debounce behavior.

## Consequences

- The visible script, installed tool, watcher, process restart, and terminal
  output are the real package path.
- A node child sees the same VFS as its parent while preserving the
  single-OPFS-writer invariant through the existing synchronous relay.
- `child_process` gains only the process-listing command subset required by the
  installed tool; unsupported commands remain loud ENOENT.
- From-scratch server starters install one additional dependency tree and take
  longer on first boot.
- This does not claim shell-process groups, arbitrary OS commands, or generic
  descendant discovery across independently nested process managers.
