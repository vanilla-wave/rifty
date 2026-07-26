---
area: playground
status: ready
title: Real nodemon restarts for Workbench Node-server projects
created: 2026-06-12
why: Express, Hono, and Koa execute their entry once, so owner-VFS edits leave the running app and preview stale until the developer stops and reruns the command
user_story: As a developer running a curated Node server, I want installed nodemon to replace the app on each source edit and recover after a syntax crash, but today Workbench executes the entry only once.
epic: real-node-server-dev-loop
sources: [ADR-0012, ADR-0137, ADR-0150, ADR-0174, ADR-0225, ADR-0230, ADR-0257, ADR-0265, ADR-0267, ADR-0278, ADR-0294, ADR-0313, ADR-0324, ADR-0325, ADR-0326, ADR-0327, Node-v24.16.0-probe, nodemon-3.1.14-reachability]
code: [packages/io/src/event-emitter.ts, packages/kernel/src/process-manager.ts, packages/kernel/src/spawn-worker.ts, packages/kernel/src/shared-globals.ts, packages/kernel/src/worker-entry.ts, packages/kernel/src/ipc/sync-dispatch.ts, packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/builtins/child_process-exec.ts, packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/builtins/worker_threads.ts, packages/runtime-js/src/ipc/recursive-runner.ts, packages/runtime-js/src/module-loader/cjs.ts, packages/runtime-js/src/module-loader/loader.ts, packages/runtime-js/src/module-loader/registry.ts, packages/workbench/src/workbench/project-definition.ts, packages/workbench/src/workers/node-entry-bootstrap.ts, packages/workbench/src/workers/owner-child-bin-executor.ts, packages/workbench/src/workers/owner-child-node-executor.ts, packages/workbench/src/workers/preview-producer-bindings.ts, packages/workbench/src/workers/preview-registry.ts, packages/workbench/src/workers/workbench-owner-controller.ts, packages/workbench/src/workers/workbench-owner-runtime.ts, packages/workbench/src/workers/workbench-project-runtime.ts, apps/playground/src/templates/project-spec.ts, apps/playground/src/templates/express-sqlite.ts, apps/playground/src/templates/hono-api.ts, apps/playground/src/templates/koa-api.ts]
---

## Context

This sole vertical unit owns five coupled contracts forced by real
`nodemon@3.1.14`:

1. `EventEmitter.call(this)` and `util.inherits` initialize the same listener
   state as modern construction.
2. One CJS ModuleRegistry record supplies Node module metadata, graph identity,
   cache publication, and loaded/failure lifecycle.
3. Recursive spawn/fork creates real Workers over ADR-0267's entry bootstrap
   and the existing owner-backed sync-FS relay.
4. One child-process plan and federated kernel authority own stdio, optional
   public JSON IPC, private control, PID/PPID trees, finite process discovery,
   signalling, output drain, exit, and teardown.
5. Exact Workbench script selection composes the existing PTY admission,
   PreviewRegistry, owner lifecycle, and route generation.

Current `WorkerStdioPorts.ipc` conflates public fork IPC with TTY/private
control and exposes `process.send` to ordinary spawns. Workbench starts nodemon
as an installed-bin spawn, so nodemon's own `process.send` must be absent.
Nodemon forks its app, so the app child alone receives public default-JSON IPC.
Private listening/removal/physical-exit control stays available after logical
public disconnect and never appears as a guest `'message'`.

Every realm currently allocates its own PIDs; recursive exec paths also own
separate `0xC0000000+` counters. That cannot produce a truthful `ps` tree.
ADR-0326 federates the existing ProcessManager instead of adding a Workbench
ledger. Workbench retains its existing owner token, PTY `(sid,rid)`,
`previewScope`, PreviewRegistry, and cross-realm port-claim owners. VFS document
epochs and package-admission FIFOs are not process generations.

The private descendant lane carries exact process/listening facts to the
existing Workbench owner. It must not expose `rifty:node-listening` through
public fork IPC, create a second watcher/registry/lifecycle owner, or snapshot
the project into a private child mirror.

## User scenario

The epic's Express + SQLite scenario is the full acceptance journey. Hono and
Koa each run the identical pinned `dev` command and prove one edit/restart.
Markdown SSG and Socket Lab keep their direct-Node commands and prove selector
non-interference.

## Acceptance

1. Express, Hono, and Koa pin `nodemon@3.1.14`; `dev` is exactly
   `nodemon --legacy-watch --no-stdin --no-update-notifier src/main.js`, while
   `start` remains `node src/main.js`. Markdown SSG and Socket Lab retain their
   direct-Node commands.
2. The npm boundary selects behavior from exact `scripts.dev` bytes and
   executes installed `.bin/nodemon`; no template ID, public `devRunner` field,
   Playground watcher, or missing/broken-nodemon fallback exists.
3. The exported EventEmitter remains one constructor/listener-state owner for
   `new`, subclassing, `EventEmitter.call(target)`, and `util.inherits`;
   nodemon's real Bus constructs successfully.
4. One CJS record owns `id`, `filename`, `path`, `paths`, first-parent identity,
   parent/children links, `loaded`, cache publication, cycle visibility, and
   failed-load unlink; nodemon's real `module.parent.filename` and parent walk
   succeed without a parallel metadata graph.
5. Nodemon's `fork()` creates a fresh real Worker whose relative entry, argv,
   cwd, inherited/replacement env, reads, and writes resolve against the same
   owner-backed project namespace. Missing or incomplete relay/bootstrap proof
   fails before PID/Worker allocation.
6. One validated child-process plan owns `pipe`/`inherit`/`ignore`, explicit
   process stdio targets, fork's single `ipc` slot, public stream/null
   properties, `.stdio`, and optional public IPC. The exact no-stdin fork has
   `stdin`, `stdout`, and `stderr` equal to `null`, four null `.stdio` slots,
   and a connected public IPC channel; nodemon never calls
   `process.stdin.unpipe`.
7. Plain spawn has no public IPC. Fork uses Node default JSON both ways;
   unsupported values fail in Node order without poisoning the channel.
   Logical disconnect never closes private TTY/process/descendant control.
8. One owner-root ProcessManager allocates non-colliding PID/PPID identity for
   recursive process Workers. Nested managers relay trusted
   reserve/commit/abort/settle operations; `worker_threads` keeps `threadId`
   outside the process table.
9. The finite virtual process surface implements the exact consumer forms:
   `exec('ps')`, `spawn('ps', ['-A', '-o', 'ppid,pid'])`,
   `child.kill('SIGUSR2')`, and `exec('kill -USR2 <pid>')`. It reports one
   coherent tree snapshot and exact signal exit; every other command, `ps`
   form, kill form, or process-group operation is a directed compat gap.
10. A private typed descendant-control path reports app listening, port
    removal, physical exit, and supervisor death to the existing Workbench
    owner with launch provenance. Public Node IPC never carries these frames.
11. Preview readiness still requires exact PTY admission plus a routed response
    from the current app generation. Old exit, output/control drain, route
    removal, and port release precede replacement readiness.
12. Ctrl-C, project switch, session close, launch failure, and current-session
    peer death physically settle the process subtree, channels, routes, and
    records once. Browser/owner reload reconstruction is not claimed.
13. Built Chromium proves every epic invariant. Unit/browser-unit tests cross a
    real supervisor→app Worker boundary; Node parity runs the same primitive
    scenarios against Node 24.16.0 and rifty.
14. Every affected package CHANGELOG and public compat row is updated;
    unclaimed surfaces remain ❌ and throw rather than approximating.

## Reference contract

- Oracle: Node `v24.16.0`.
- Consumer: `nodemon@3.1.14`,
  SHA-512
  `jakjZi93UtB3jHMWsXL68FXSAosbLfY0In5gtKq3niLSkrWznrVBzXFNOEMJUfc9+Ke7SHWoAZsiMkNP3vq6Jw==`.
- Process-tree consumer: `pstree.remy@1.1.8`,
  SHA-512
  `77DZwxQmxKnu3aR542U+X8FypNzbfJ+C5XQDk3uWjWxn6151aIMGthWYRXTqT1E5oJvg+ljaa2OJi+VfvCOQ8w==`.
- Resolved forcing closure includes `chokidar@3.6.0` and
  `minimatch@10.2.5`.
- Reproducible acquisition, source reachability, commands, versions, and
  captured output:
  `docs/backlog/playground/reference/nodemon-3.1.14-reachability.md`,
  `docs/backlog/playground/reference/nodemon-3.1.14-node-probe.md`, and
  `docs/backlog/playground/reference/nodemon-3.1.14-loop-probe.md`.

## Parity cases

1. EventEmitter call/new/subclass/`util.inherits`, return value, prototype
   identity, `instanceof`, and shared listener state.
2. CJS metadata during fresh, cached, cyclic, successful, and failed loads,
   including first-parent and failed-child unlink.
3. Worker spawn/fork relative entry, argv, cwd, inherited/replacement env,
   parent-written child-read bytes, child-written parent-read bytes, and one
   recursive descendant.
4. Default pipe, ignore, inherit, explicit process stdio objects, fork IPC
   insertion, public stream/null fields, and every `.stdio` slot.
5. Plain-spawn IPC absence; fork `connected`/disconnect; default JSON both ways;
   omitted function properties; circular-send failure followed by a valid send.
6. Bare `ps`, formatted `ps -A -o ppid,pid`, coherent PPID/PID rows,
   `SIGUSR2` child kill, and exact `kill -USR2 <pid>` callback/status.
7. Ordered stdin writes where piped, one EOF, final stdout/stderr drain,
   exit-before-close ordering, natural exit, and signal exit.
8. Real nodemon initial start, one edit, syntax crash/recovery, rapid-edit
   convergence, same-port reuse, and teardown.

## Fault matrix

Boundary model: live MessagePorts are ordered/exactly-once; replay, duplicate,
and reorder are physically excluded. SAB exchange cannot lose/reorder frames,
but second callers, abandoned exchange, responder death, and oversize replies
are reachable. Broadcast listeners may miss while absent; the service worker
may die between events.

| Axis × operation | Injected fault | Honest outcome |
|---|---|---|
| `corrupt-input` × spawn plan | Invalid/duplicate stdio IPC slot or malformed v2 bootstrap | Reject before PID/Worker publication; no partial child. |
| `corrupt-input` × live control | Malformed/unknown private frame after child publication | Decoder rejects it, visibly fails/settles that exact run, and performs no preview mutation or successor teardown. |
| `torn-state` × reserve/spawn | Worker, port, SAB, listener, or postMessage fails after PID reservation | Abort the record and close every acquired resource; no visible child/orphan. |
| `provenance-lie` × recursive FS | Missing/stale relay, root, admission, or capability | Throw before allocation; no empty mirror, snapshot, or same-realm fallback. |
| `unbounded-read` × remote FS | Oversized/no-progress chunk sequence | Bounded completion or loud failure; never hang or truncate. |
| `concurrent-same-key` × SAB ring | A second caller/consumer reaches one live exchange | One-client/one-dispatcher guard rejects before interleaved mutation; no zero-length or cross-request reply. |
| `unbounded-read` × SAB reply | Reply exceeds ring capacity | Bounded chunking where owned or the existing in-band oversize error; never truncate, wedge, or silently retry. |
| `unbounded-read` × SAB call | Abandoned exchange or responder death | Owner/parent death terminates the physical caller or yields a bounded visible failure; no fallback or infinite admitted run. |
| `observable-order` × JSON IPC | Circular invalid send followed by valid send | First throws Node's error synchronously; channel remains usable and ordered. |
| `torn-state` × child exit | Exit with output/control/network work in flight | Final output drains; public/private lanes, record, and Worker settle exactly once. |
| `concurrent-same-key` × process snapshot | `ps` races child exit/restart | One coherent table snapshot; no half row or reused live identity. |
| `concurrent-same-key` × edit/port | Rapid writes and replacement race old teardown/claim | Final bytes win; one app, one route, and one port owner remain; real `EADDRINUSE` is visible until release. |
| `provenance-lie` × readiness | Log/listening frame lacks current PTY/PID/scope or routed response | Run remains unready; stale exact route is removed without clearing a successor. |
| `observable-order` × close | Ctrl-C/project/session close races queued watch/restart | Closure fences new reservations; subtree, routes, and channels cannot resurrect. |
| `torn-state` × MessagePort peer death | Supervisor/owner/control peer dies with an active run | Physical subtree death is browser-proven; readiness/routes invalidate visibly, with no fabricated exit or reconstruction. |
| `provenance-lie` × package launch | nodemon is missing/corrupt or `.bin` resolution fails | Exact visible command failure; never claim the consumer ran or execute the entry directly. |
| `provenance-lie` × Broadcast/SW | Preview listener attached late, SW dies, or routed probe stalls/fails | Existing request/snapshot handshake recovers live owner state; otherwise preview stays visibly unready/error, never inferred from logs. |
| `sibling-drift` × backends/templates | Same-realm/Worker plan, direct-node sibling, or one server template diverges | Shared plan suite plus Express/Hono/Koa and Markdown/Socket regression cases detect drift. |

## Out of scope

- Browser/owner crash or reload reconstruction (`production` tier).
- Playground watcher, synthetic nodemon output, direct-entry fallback,
  template-ID runtime branch, or new public runner selector.
- General shells, `/proc`, OS process groups/job control, arbitrary `ps`,
  arbitrary `kill`, and signals beyond the claimed consumer forms.
- Numeric descriptors beyond the claimed stdio plan, `overlapped`, extra pipes,
  and unrestricted descriptor inheritance.
- Advanced IPC serialization, handle transfer, channel `ref()`/`unref()`, and
  send callbacks/options; each remains a named `NotImplementedError` + compat
  ❌.
- General `process.stdin` pull/pipe/unpipe/raw/async-iteration parity; the exact
  `--no-stdin` journey does not call it.
- Full binary stdio backpressure, `require.cache` facade/delete/reload,
  same-realm queued-handler kill cancellation, and Vite/HMR changes.

## Decisions

ready-verdict: 2026-07-26 — User scenario and Acceptance 1–14 are fixed by the ready epic and exact installed-nodemon journey; Reference contract and Parity 1–8 are verified by pinned Node 24.16.0, nodemon 3.1.14, and pstree.remy 1.1.8 executable artifacts; the robust Fault matrix covers the reachable launch, MessagePort, SAB, remote-FS, process-tree, route, package, Broadcast/SW, and teardown boundaries while physical exclusions and reload recovery are explicit; Out of scope names loud compat gaps; ADR-0324–0327 settle callable EventEmitter, sole CJS record, federated process/IPC/control, and exact-script-selection forks; the mechanism sweep leaves one ProcessManager ledger, one launch plan and terminal state machine, existing PTY/preview provenance, and nodemon/chokidar watch ownership, with absorbed drafts removed and adjacent require-cache, same-realm kill, and Worker-fallback work non-overlapping.

- ADR-0324 makes the existing EventEmitter listener store callable; no wrapper
  state is introduced.
- ADR-0325 makes the existing ModuleRegistry record the sole CJS metadata and
  lifecycle owner.
- ADR-0326 atomically introduces node-entry v2, federates ProcessManager over
  the trusted existing SAB chain, removes duplicate recursive PID allocators,
  and separates optional public fork JSON from private typed control on the
  existing physical port.
- Recursive FS composes ADR-0267 and the current owner relay/root. It never
  falls back to a project snapshot/private mirror.
- One validated child-process plan shapes Worker and same-realm claimed
  surfaces. Unsupported shapes fail before allocation.
- The descendant lifecycle carrier reuses Workbench owner admission,
  `(ptySid,ptyRid)`, `previewScope`, and PreviewRegistry. Kernel owns no preview
  route; Workbench owns no PID ledger.
- ADR-0327 makes exact `scripts.dev` bytes select installed nodemon; canonical
  direct-node siblings retain their current path. Nodemon/chokidar alone own
  watching and debounce; default edit signal is `SIGUSR2`.
- Robust scope excludes browser/owner reload reconstruction but requires honest
  current-session peer-death and teardown outcomes.
