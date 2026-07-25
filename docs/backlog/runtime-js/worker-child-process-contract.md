---
area: runtime-js
status: draft
title: Node-observable contract for Worker-backed child processes
created: 2026-07-17
why: generic Worker children lack one faithful spawn/fork boundary for cwd, argv, env, stdio shape, JSON IPC, process discovery, exact exit, drain, kill, and physical Worker/channel teardown
epic: real-node-server-dev-loop
blocked_by: [runtime-js/generic-spawn-worker-remote-fs]
sources: [ADR-0045, ADR-0225, ADR-0230, ADR-0257, ADR-0267]
code: [packages/kernel/src/process-manager.ts, packages/kernel/src/spawn-worker.ts, packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/builtins/child_process-exec.ts, packages/runtime-js/src/ipc/install-process.ts, tests/conformance/builtins/child_process-worker.test.ts]
---

## Context

Remote-FS provenance alone does not make a Worker a Node child process. The
current public boundary always exposes three streams and no `.stdio` array,
does not own a shared descriptor-validation plan, transports fork messages as
structured-clone values instead of Node default JSON, and cannot answer the
finite process-table query used by nodemon's descendant cleanup. These
observables share process allocation and terminal settlement; splitting them
across independent implementations would recreate sibling drift.

This item owns one spawn/fork plan across Worker and same-realm claimed
surfaces: cwd-relative entry and argv, exact inherited/replacement guest env,
public stdio/nullability and ordered stdin EOF, default-JSON IPC in both
directions with failure survival, logical disconnect isolated from typed
control frames, bare `ps` plus `ps -A -o ppid,pid`, and exact exit/kill/output
drain/channel/physical-Worker teardown. Validation must finish before PID/Worker
allocation. Every valid-but-unwired stdio or `ps` form and advanced IPC mode
remains a directed loud gap. The public and wire contract needs a fresh ADR
after the required ADR-0045 decision audit, composed with the current
PTY/bootstrap decisions, before this child can become `ready`.

Runtime-js and kernel stop at physical process, stream, channel, and exact-exit
settlement. Playground Workbench owns PreviewRegistry route removal,
same-port replacement readiness, and stale-route prevention.
