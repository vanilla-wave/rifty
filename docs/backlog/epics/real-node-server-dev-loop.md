---
kind: epic
status: draft
title: Real Node server dev loop — edit, restart, recover
created: 2026-07-17
value: A developer runs a real Node server under real nodemon in the browser; source edits replace the app faithfully on the same preview port, including crash recovery and teardown.
user_story: As a developer using Express, Hono, or Koa in rifty, I want `npm run dev` to run real nodemon so edits restart my app and preview automatically, but today the server keeps stale code until I stop and rerun it.
tier: robust
sources: [ADR-0150, ADR-0174, ADR-0225, ADR-0230, ADR-0237, ADR-0255, ADR-0257, ADR-0265, ADR-0267, ADR-0269, ADR-0270, ADR-0272, ADR-0278]
---

## Refinement decision

- `tier: robust` — user-confirmed 2026-07-26. Preserve edit convergence,
  syntax-crash recovery, and exact teardown under every reachable runtime fault.
  Reconstructing nodemon, its app descendant, and preview routing after the
  browser or owner itself crashes or reloads is not promised.

## Refinement evidence

- Node `24.16.0` with installed `nodemon@3.1.14` is the consumer oracle.
- The exact `--no-stdin` path gives the forked child inherited descriptors with
  public `stdin`/`stdout`/`stderr` set to `null`; it never calls `unpipe`.
  `runtime-js/process-stdin-readable-surface` is therefore not epic-reachable.
- Nodemon directly reaches callable EventEmitter construction,
  `module.parent.filename`, recursive `fork()`, explicit inherited stdio plus
  IPC, and the `pstree.remy` bare and formatted `ps` calls.
- The current Workbench already owns project/session lifecycle, preview
  admission, entry bootstrap, and remote-FS provenance. The residual recursive
  substrate gap starts at generic `spawn`/`fork`, which still fails loudly.
- Queued same-realm `ProcessManager.spawn()` cancellation is a real sibling
  fault but is not reached by this Worker-supervisor journey.

## Outcome

Express, Hono, and Koa projects use the installed real `nodemon` package as
their development supervisor. Nodemon runs as a supervised Node Worker, spawns
the application in a fresh child Worker over the same owner-backed VFS, and
publishes only the terminal output, exits, and routed HTTP responses that the
real processes produce. There is no playground watcher, synthetic restart log,
direct-node fallback, or readiness inferred from stdout.

This turns the curated server projects into a forcing proof for the reusable
Node substrate: legacy EventEmitter construction, CJS module metadata,
`process.stdin`, fork IPC, child stdio, process discovery, recursive Worker
spawn, shared files, exact exit, and same-port replacement must agree with real
Node before the browser dev loop can claim success.

## User scenario

A developer opens the Express + SQLite project and runs `npm run dev`, which
executes the installed `nodemon@3.1.14` with
`--legacy-watch --no-stdin --no-update-notifier src/main.js`. The Workbench
terminal shows nodemon's own output and the preview becomes ready only after a
routed HTTP response from the app child.

The developer edits `src/main.js`. Nodemon observes the owner-VFS write,
terminates the old app Worker, starts a fresh Worker, and serves the edited
response on the same preview port. Realm-local SQLite state resets, proving the
old realm died. Invalid syntax produces the real crash on stderr; a later valid
edit recovers without rerunning `npm run dev`. Rapid edits converge on the final
bytes with one live app and no stale port holder. Ctrl-C or project switching
terminates nodemon and its descendant and prevents a queued watch event from
resurrecting either. Hono and Koa each complete one same-port edit/restart;
Express owns the full crash, recovery, state-reset, and teardown journey while
shared substrate tests prove those contracts are not template-specific.

## Items

- `kernel/queued-process-kill-cancellation` (draft) — make kill-before-start terminal and prevent queued same-realm work from executing or publishing late outcomes.
- `runtime-js/callable-event-emitter` (draft) — preserve modern construction while supporting the legacy `EventEmitter.call(this)` pattern used below nodemon.
- `runtime-js/process-stdin-readable-surface` (draft) — add the Readable identity and passive `unpipe` reached by nodemon's `--no-stdin` path without regressing ADR-0230 flow, EOF, or TTY behavior.
- `runtime-js/cjs-module-record-metadata` (draft) — expose Node-observable `module` identity, parent/children links, and loaded transitions used by nodemon.
- `runtime-js/generic-spawn-worker-remote-fs` (draft) — spawn recursive Node/fork children as real Workers over the current entry bootstrap and owner-backed remote FS.
- `runtime-js/worker-child-process-contract` (draft; blocked by generic Worker remote FS) — own the complete Node-observable Worker child boundary: cwd/argv/env, stdio, JSON IPC, supported `ps`, exact exit, drain, kill, and physical Worker/channel teardown.
- `playground/node-server-restart-on-edit` (draft; blocked by every substrate item above) — pin and run real nodemon through the current Workbench owner, PTY, preview, and project-runtime boundaries.

The first five prerequisites may land independently. The Worker child contract
deepens the transport as one state machine instead of splitting IPC, stdio,
process discovery, and teardown into drifting owners. The playground item is
the only integration slice and the end-to-end acceptance owner.

## Acceptance

1. Express, Hono, and Koa pin `nodemon@3.1.14`; `dev` uses the exact command in
   the scenario and `start` remains direct `node`.
2. The current Workbench Node-server runtime executes installed `.bin/nodemon`;
   missing or broken installation fails without a direct-entry fallback.
   `scripts.dev` is the selector: existing direct-node Markdown SSG and Socket
   Lab projects retain their current path without template-ID branching.
3. The nested app Worker sees the owner-backed project, exact cwd/argv/env, and
   Node-observable stdio/IPC/process records.
4. Preview readiness requires the admitted PTY run plus a routed HTTP response;
   logs, spawn events, and bare port advertisements never suffice.
5. Built Chromium proves edit, rapid edits, realm-state reset, syntax
   crash/recovery, and same-port replacement for Express; Hono and Koa each
   prove at least one real edit/restart.
6. Ctrl-C, project switch, owner death, and session close settle supervisor,
   descendant, channels, process records, and preview ownership exactly once.
7. Browser-unit proof crosses the real recursive Worker boundary. Node parity
   covers every claimed primitive and child-process behavior.
8. Each child reaches `ready` before implementation; its public/wire decisions,
   compatibility gaps, fault matrix, and CHANGELOG effects land with it.

## Parity cases

Oracle: Node 24.16.0.

1. EventEmitter call/new/subclass/`util.inherits`, prototype identity, and
   `instanceof`.
2. Process stdin Readable identity, passive `unpipe`, pause/resume/isPaused,
   split UTF-8, pre-listener data, and one EOF.
3. CJS module metadata for fresh, cached, cyclic, successful, and failed loads.
4. Worker `spawn('node', ...)`: relative entry, argv, cwd, inherited versus
   replacement env, owner-created file bytes, and exit.
5. Stdio pipe/inherit/explicit targets/fork defaults, public
   `stdin`/`stdout`/`stderr`, and every `.stdio` slot.
6. Plain-spawn IPC absence; fork default JSON both ways; omitted function
   values; circular-send failure followed by a successful send; disconnect and
   exit ordering.
7. Ordered stdin writes, one EOF, and final output drain.
8. Bare `ps` and `ps -A -o ppid,pid` for the supported virtual process table.
9. Natural exit, SIGINT/SIGTERM, pre-start kill, and final stdio/close order.
10. Real nodemon initial start, edit restart, syntax recovery, rapid-edit
    convergence, same-port reuse, and teardown.

## Fault matrix

| Axis × operation | Injected fault | Honest outcome |
|---|---|---|
| `observable-order` × queued start | Kill before the spawn microtask | Handler never runs; one signal exit/close; no late output or natural exit. |
| `provenance-lie` × remote FS | Missing or partial relay | Throw before PID/Worker allocation; no private mirror or same-realm fallback. |
| `unbounded-read` × remote read | Oversized or no-progress response | Bounded chunks or loud failure; never hang or silently truncate. |
| `observable-order` × IPC | Invalid send followed by valid send | First send throws the Node error; the channel remains usable for the second. |
| `torn-state` × child exit | Exit with stdio/control/network work in flight | Final output drains; every lane, record, and port settles once. |
| `concurrent-same-key` × restart | Rapid edits overlap old-child teardown | Final bytes win; one app Worker and one port owner remain. |
| `provenance-lie` × readiness | Logs appear without a routed response | Run stays unready and fails with exact owner/terminal provenance. |
| `observable-order` × closure | Ctrl-C or project close races a queued restart | Closure wins; no descendant or preview route resurrects. |
| `sibling-drift` × templates/backends | One template or spawn path diverges | Shared contracts cover all three templates and every claimed backend. |

## Decisions

- The forcing consumer is installed `nodemon@3.1.14`; no custom watcher,
  synthetic output, direct-entry substitution, or missing-launcher fallback.
- PR #129 and `codex/pr129-convergence` are contract quarries only. No old
  `App.tsx`, process, PTY, Worker, Readable, or env-control implementation is
  transplanted.
- Recursive workers use ADR-0267 entry-scoped host bootstrap and fresh launch
  metadata. Guest `process.env` remains exact; no `RIFTY_*` launch controls.
- Runtime-js owns public Node serialization and stream shape. Kernel control
  frames remain typed, private, and usable after logical IPC disconnect.
- Default-JSON IPC is the required Node-visible outcome, but it changes the
  ADR-0045 contract. Implementation cannot begin until the child refinement
  runs the required decision audit and lands a successor or correction ADR.
- Workbench owns project/session lifecycle and PTY admission. Preview readiness
  requires the exact owner PTY run plus a real routed HTTP response per
  ADR-0265; logs and spawn events cannot make it ready. Workbench's
  PreviewRegistry, not runtime-js, owns route removal and same-port replacement.
- Each app restart replaces the complete Worker realm. Replacement readiness
  follows old-realm exit, channel drain, preview removal, and port release.

## Out of scope

- PR #129 first-run polish: chooser scratch adoption, Share/search policy,
  starter labels, terminal hints, and Project Files presentation.
- Vite HMR or Vite runtime changes; Vite keeps its installed `.bin/vite` path.
- Native executables, OS process groups, job control, arbitrary `ps` formats,
  raw TTY mode, and unrestricted numeric/non-IPC descriptors.
- Node advanced IPC serialization and channel `ref()`/`unref()`; those remain
  directed compat gaps rather than structured-clone approximations.
- Full binary stdio backpressure, tracked by
  `kernel/binary-stdio-messageport-backpressure`, is not claimed by this epic.
