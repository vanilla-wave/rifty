# ADR 0327: Installed nodemon owns the Workbench Node-server dev loop

Status: Accepted
Date: 2026-07-26

> TL;DR: Express, Hono, and Koa pin and execute real nodemon; exact script bytes
> select the existing direct-entry or installed-bin Workbench path.

## Context

Workbench currently intercepts every Node-server `dev` script and executes the
entry once, even though the npm boundary already knows the resolved script
body. Owner-VFS edits therefore leave stale application code until the user
reruns the command. A Playground watcher or synthetic restart would not prove
Node package compatibility and would duplicate lifecycle and preview owners.

## Decision

- Express, Hono, and Koa pin `nodemon@3.1.14` and set `dev` exactly to
  `nodemon --legacy-watch --no-stdin --no-update-notifier src/main.js`.
  `start` remains `node src/main.js`.
- Exact resolved `scripts.dev` bytes are authoritative. Only the canonical
  direct `node <project entry>` body selects the dedicated direct-entry
  controller. Every other script executes through the existing nested Shell
  and installed `.bin` resolution, including nodemon. There is no template-ID
  branch, public `devRunner` field, command approximation, or missing/broken
  launcher fallback.
- Nodemon/chokidar alone own watching, debounce, app restart, and their real
  terminal output. Workbench adds no file watcher or synthetic status line.
- The owner captures the PTY admission once at supervisor launch. Private
  descendant control from ADR-0326 updates the existing PreviewRegistry using
  process identity plus the existing fresh `previewScope`; no second registry,
  PID mirror, or restart epoch is introduced.
- Preview becomes ready only for the admitted PTY run and current app
  generation after a routed HTTP response. Old app exit, output/control drain,
  route removal, and port release precede replacement readiness.
- `robust` scope includes final-write convergence, fresh app realm/state,
  syntax-crash recovery, same-port replacement, and exact Ctrl-C/project/
  session teardown. Browser/owner crash-or-reload reconstruction is not
  promised; peer death visibly invalidates the run and routes.
- Express owns the full browser journey. Hono and Koa each prove one same-port
  edit/restart through the same substrate. Markdown SSG and Socket Lab remain
  direct-node regression siblings.

## Consequences

- Curated templates gain one exact external dependency and lock/provenance
  obligation; installed package code, not Playground code, controls restarts.
- The generic installed-bin path becomes the forcing integration for callable
  EventEmitter, CJS records, recursive fork, stdio/JSON IPC, process discovery,
  owner-backed VFS, and subtree teardown.
- Built-Chromium acceptance must observe real nodemon output, routed response
  bytes, realm-state reset, crash/recovery, rapid edits, and no residual process
  or route after closure.
- Unsupported process/IPC/stdio surfaces remain named
  `NotImplementedError`s with compat ❌; no approximation is introduced.

Corrects ADR-0130 D4: explicit script bytes are no longer replaced by a
generated direct command. Corrects ADR-0150 and ADR-0174: the dedicated
Node-server lifecycle applies only to canonical direct-entry scripts; installed
nodemon uses the generic `.bin` path. ADR-0278's public companion surface and
PreviewRegistry ownership are unchanged.

References: ADR-0265, ADR-0278, ADR-0324, ADR-0325, ADR-0326,
`docs/backlog/playground/reference/nodemon-3.1.14-reachability.md`.
