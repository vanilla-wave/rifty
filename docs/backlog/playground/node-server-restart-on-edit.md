---
area: playground
status: draft
title: Real nodemon restarts for Workbench Node-server projects
created: 2026-06-12
why: Express, Hono, and Koa execute their entry once, so owner-VFS edits leave the running app and preview stale until the developer stops and reruns the command
epic: real-node-server-dev-loop
blocked_by: [kernel/queued-process-kill-cancellation, runtime-js/callable-event-emitter, runtime-js/process-stdin-readable-surface, runtime-js/cjs-module-record-metadata, runtime-js/worker-child-process-contract]
sources: [ADR-0130, ADR-0174, ADR-0230, ADR-0257, ADR-0265, ADR-0278]
code: [apps/playground/src/templates/project-spec.ts, apps/playground/src/templates/express-sqlite.ts, apps/playground/src/templates/hono-api.ts, apps/playground/src/templates/koa-api.ts, apps/playground/src/workbench/project-definition.ts, apps/playground/src/workbench/project-definition.test.ts, apps/playground/src/workbench/node-project-runtime.ts, apps/playground/src/workers/workbench-project-runtime.ts, apps/playground/src/workers/owner-child-dev-server.ts, tests/e2e/fullstack-demo.spec.ts, tests/e2e/hono-api.spec.ts, tests/e2e/koa-api.spec.ts]
---

## Context

The current Workbench Node-server runtime owns one supervised dev-server child
and derives readiness from the admitted PTY run plus the routed HTTP proof. It
does not restart the imported application when project bytes change. PR #129's
page-owned `App.tsx`, `node-server-runner`, env controls, and old PTY/process
seams predate the Workbench companion and cannot be revived.

The existing npm boundary receives both script name and `scripts.dev` command
but currently intercepts every Node-server `dev` script and ignores the command.
The command becomes the sole runtime selector: the exact nodemon command routes
through installed `.bin/nodemon`; existing direct-node commands retain the
current supervised path. There is no template-ID branch or new public
`devRunner` field. Markdown SSG and Socket Lab are regression siblings and must
keep their current direct-node behavior.

This item is the integration and acceptance owner for the epic. Express, Hono,
and Koa pin `nodemon@3.1.14`; their development command executes the installed
`.bin/nodemon`, which uses the completed runtime children to spawn and replace
the app Worker. Nodemon owns watching and debounce. Workbench remains the sole
project/session owner, the owner PTY actor remains the stdin/resize/signal/exit
authority, and preview readiness remains exact `(ptySid, ptyRid)` correlation
plus a real routed HTTP response. Missing/broken nodemon, app crash, teardown,
or port-release failure stays visible; none falls back to direct `node` or a
playground watcher. Workbench's PreviewRegistry owns route removal and proves
old-port release before replacement readiness; runtime-js never owns preview
routes.

Changing curated dependencies, commands, and runtime behavior is irreversible;
a fresh ADR against the current owners is required before this item can become
`ready`.
