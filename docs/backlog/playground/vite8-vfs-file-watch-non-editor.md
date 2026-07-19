---
area: playground
status: draft
title: Browser-prove non-editor writes reach Vite polling watch
created: 2026-06-21
why: The installed Vite child polls the remote owner VFS through fs.watch, and unit tests prove owner writes emit events, but no browser test proves a terminal/tool write refreshes the preview.
user_story: As a developer changing a file from the terminal or a tool, I want the running Vite preview to observe it like real Vite, not stay silently stale.
sources: [packages/runtime-js/src/builtins/fs-watch.ts, packages/runtime-js/src/ipc/sync-rpc-fs.test.ts, packages/workbench/src/workers/node-entry-bootstrap.ts]
code: [packages/runtime-js/src/builtins/fs-watch.ts]
---

## Context

The retired curated path forwarded editor saves through bespoke IPC. Installed
`.bin/vite` now uses polling `fs.watch` over the remote owner mirror, so editor,
terminal, generated, and npm writes share one mechanism. Unit coverage proves
owner-write→remote-watch; browser coverage proves editor HMR only.

## Options or Next

Browser-test a terminal or Node-program write while Vite runs; assert the
preview observes the new bytes. Unit polling evidence alone does not close the
user scenario.

## Reversibility

REVERSIBLE — proof over the existing generic `.bin` polling path.
