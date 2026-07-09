---
area: runtime-js
status: ready
title: Wire remote-FS into generic Worker-backed child_process spawn
created: 2026-06-17
why: a Worker-backed Node child must observe the parent-owned VFS; the old generic route either saw an empty private mirror or had to throw
user_story: As a developer running a Node supervisor or nodemon, I want `spawn('node', …)` and `fork()` children to read the same project files as their parent, with real stdio, stdin, IPC, exit, and server lifecycle behavior.
sources: [ADR-0011, ADR-0137, ADR-0150, ADR-0202]
code: [packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/builtins/child_process-worker.ts, packages/runtime-js/src/ipc/fs-handlers.ts, packages/runtime-js/src/ipc/sync-rpc-fs.ts, packages/kernel/src/process-manager.ts, packages/kernel/src/process-channels.ts, apps/playground/src/workers/node-entry-bootstrap.ts, apps/playground/src/browser-unit/child-process-remote-fs-harness.ts]
---

## Context

The generic Worker route previously had no truthful filesystem path. A child Worker owns a separate JavaScript realm and therefore cannot use a private in-memory mirror: Node children observe the same filesystem namespace as their parent. The temporary safe behavior was `NotImplementedError('child_process.spawn[worker]')`.

The owner already serves its authoritative VFS through the ADR-0150 synchronous `fs.*` relay for supervised `.bin` children. Generic `spawn('node', …)` and `fork()` must reuse that owner-backed path, but only when the current dispatcher proves it has the complete handler set. A global flag or optimistic `RIFTY_REMOTE_FS=1` would let a new dispatcher claim another dispatcher’s capability and recreate the empty/stalled-child bug.

This contract also owns the Node-observable Worker child boundary: cwd/env/argv, supported stdio, stdin data plus EOF, plain-spawn versus fork IPC shape, exit/kill cleanup, and server-port ownership.

## User scenario

A developer creates `/project/data.txt` and `/project/child.mjs` in the rifty project, then runs:

`spawn('node', ['child.mjs'], { cwd: '/project', env: { PROBE_FLAG: 'worker-env' } })`

The child reads `/project/data.txt` through `node:fs`, reports `/project` from `process.cwd()`, receives `PROBE_FLAG`, accepts `child.stdin.write('hello'); child.stdin.end()`, writes output, and exits with code 0. A plain spawned child has no Node IPC API.

The same supervisor can use:

`fork('/project/ipc.mjs', [], { cwd: '/project' })`

The forked child sees the same files and exchanges default JSON IPC messages. This is the path the installed real nodemon uses to supervise an application Worker that watches and serves the parent-owned project.

## Acceptance

1. A dispatcher is remote-FS-capable only after `installRuntimeJsFsHandlers` registers the complete handler set on that dispatcher instance.
2. When the Worker route and complete relay are available, `spawn('node', …)` and `fork()` create a real node-entry Worker with `RIFTY_REMOTE_FS=1`; loader and `node:fs` use the same owner-backed sync mirror.
3. Remote `exists`, `stat`, `statOrNull`, `readdir`, bounded file reads, writes, mkdir, rm, rename, utimes, copyFile, and cp route to the current owner VFS. No child opens a second OPFS owner or trusts a private mirror.
4. When a Worker route exists but its dispatcher lacks the complete relay, spawn throws `NotImplementedError('child_process.spawn[worker]')` before allocating a PID or Worker.
5. When no Worker route exists, ADR-0011’s same-realm fallback remains available over the already-installed local mirror; relay absence must not silently select that fallback when a Worker route was chosen.
6. Relative entry paths resolve once against child `cwd`; absolute entries remain unchanged. Omitted cwd snapshots the parent cwd.
7. Omitted `env` inherits the parent environment; explicit `env` replaces it. Child-only rifty capability variables are added without leaking omitted parent values.
8. Supported stdio is exactly `'pipe'`, `'inherit'`, readable/writable stream targets, and the supported fork IPC slot. Forwarded descriptors are `null` on the public `ChildProcess`; pipes remain streams.
9. Piped/inherited stdin forwards ordered bytes and exactly one EOF. A child consuming `data` and `end` exits normally after parent `end()`.
10. A plain `spawn` parent omits own `send`, `disconnect`, and `channel` properties and reports `connected:false`; its child process omits the IPC fields. Only `fork()` exposes Node JSON IPC and truthful channel presence.
11. Fork IPC works in both directions, buffers pre-listener messages in order, reports disconnect once, and remains usable after a serialization/clone failure that does not represent peer disconnect.
12. Internal structured-clone control remains independent of public Node IPC; public disconnect cannot tear down preview, VFS, or worker-thread control.
13. Natural exit and kill drain final stdout/stderr, close stdin/IPC lanes once, remove ProcessManager records and listeners, terminate the Worker realm, and release network/preview ownership.
14. A server child can be killed and replaced on the same port without a stale responder or `EADDRINUSE`.
15. Bare `ps` returns the truthful empty controlling-terminal selection; `ps -A -o ppid,pid` reports live ProcessManager parent/child records required by nodemon.
16. A real Chromium browser-unit probe covers remote VFS bytes, cwd/env, redirected output, stdin data/EOF, plain-spawn IPC absence, fork IPC, stdio shapes, and exit codes.
17. Kernel/runtime-js/playground CHANGELOGs and `docs/public/compat/process.md` bound every unsupported mode explicitly.

## Parity cases

Compare each observable result with Node 24.16.0:

1. Relative entry + cwd + env: `spawn('node', ['child.mjs'], { cwd, env })` reads a parent-created file, reports cwd/env, emits the same output, and exits 0.
2. Environment inheritance: omitted `env` inherits; explicit `{}` or a supplied map does not leak parent-only keys.
3. Stdio shape: default/`'pipe'`, `'inherit'`, explicit writable targets, default fork inheritance, and `silent:true` produce matching `stdin`/`stdout`/`stderr` null-or-stream properties.
4. Stdin lifecycle: parent writes split string/byte chunks then ends; child observes ordered data followed by one `end`, emits final output, and exits.
5. Plain spawn IPC shape: parent and child omit fork-only methods/channel; `connected` matches Node’s non-IPC value.
6. Fork IPC shape: parent→child and child→parent default JSON messages round-trip; function properties are omitted; circular serialization throws without poisoning the next send.
7. Disconnect/exit: explicit disconnect, natural exit, and kill emit each public terminal event once and reject later sends with the Node-compatible outcome.
8. Relative missing entry reports the cwd-resolved path and Node-shaped missing-module error.
9. `ps` default header-only selection and `ps -A -o ppid,pid` field/record shapes match the supported Node command forms.
10. Invalid and unsupported stdio inputs preserve Node error priority: invalid values produce Node-shaped argument errors; valid-but-unwired modes produce directed `NotImplementedError` before spawn.

## Fault matrix

| Axis × operation | Injected fault | Honest outcome and fault-test target |
|---|---|---|
| `provenance-lie` × relay capability | A dispatcher has no handlers or only a partial handler install | It is not marked capable; Worker spawn throws `child_process.spawn[worker]` before PID/Worker allocation and never claims the child sees parent bytes. |
| `false-fallback` × route selection | Worker URLs are available but the selected dispatcher lacks the FS relay | Fail loudly; do not fall back to a same-realm child and do not create an empty-mirror Worker. |
| `unbounded-read` × remote file read | File exceeds one SAB frame or a relay returns no progress before the advertised size | Read in `FS_RPC_CHUNK`-bounded frames; a short/no-progress read throws instead of hanging or returning truncated bytes. |
| `concurrent-same-key` × remote read | The owner file grows or shrinks between stat and chunk reads | Growth is bounded to the original snapshot length; shrink/short-read is loud. Never overflow the destination or silently accept truncation. |
| `quota-perm-fail` × remote mutation | Owner VFS write/mkdir/rm/rename/copy throws quota or permission failure | Propagate the failure synchronously to the child; never acknowledge success and never update a private child mirror. |
| `observable-order` × stdio validation | Request contains an invalid value or a valid-but-unwired stdio mode | Validate before allocating PID/Worker. Node-visible invalid-argument errors retain priority; capability gaps throw the directed stdio `NotImplementedError`. |
| `torn-state` × Worker exit | Child exits or is killed while stdout, stdin EOF, IPC, or control frames are in flight | Drain final output, close each public lane once, remove records/listeners, and release port ownership; never retain a half-live handle. |
| `sibling-drift` × spawn/fork and Worker/same-realm paths | One path resolves cwd/entry, stdio, or IPC shape differently | Shared entry resolution, stdio planning, process capabilities, and contract tests keep the observable Node boundary identical where both paths claim support. |
| `concurrent-same-key` × same-port replacement | Old server Worker teardown overlaps a replacement spawn | Old realm releases registry/responder ownership before replacement readiness; one owner survives, without stale responses or `EADDRINUSE`. |

## Out of scope

- A selected Worker route whose dispatcher lacks the complete FS relay remains compat ❌ through `NotImplementedError('child_process.spawn[worker]')`; page-realm FS proxying is not added.
- Stdio shorthand/entries `'ignore'`, `'overlapped'`, numeric descriptors, plain-spawn `'ipc'`, and non-IPC fd 3+ entries remain compat ❌ through `NotImplementedError('child_process.spawn.stdio')`.
- Fork IPC placed at fd 0, 1, or 2 remains compat ❌ through `NotImplementedError('child_process.spawn.stdio')`.
- `fork(..., { serialization: 'advanced' })` remains compat ❌ through `NotImplementedError('child_process.serialization.advanced')`; structured clone is not presented as Node advanced serialization.
- `process.channel.ref()` and `.unref()` remain compat ❌ through `NotImplementedError('process.channel.ref')` and `NotImplementedError('process.channel.unref')`.
- `subprocess.channel.ref()` and `.unref()` remain compat ❌ through `NotImplementedError('child_process.channel.ref')` and `NotImplementedError('child_process.channel.unref')`. The raw control `MessagePort` is never exposed.
- Native subprocesses, OS process groups, controlling-terminal metadata, and arbitrary process-table formats are not implemented. Unsupported known `ps` formats throw `NotImplementedError('child_process.ps-format')`; unknown executables retain ENOENT/127.
- Interactive terminal-session stdin is a separate terminal/PTY contract. This item covers `ChildProcess` pipe/inherit stdin, not terminal raw mode or job control.

## Decisions

- ADR-0202 is the governing irreversible decision.
- Reuse the ADR-0150 owner sync-RPC filesystem; never create or seed a second child-owned VFS.
- Capability is per `SyncRpcDispatcher` and becomes true only after the complete handler set is registered.
- A present Worker route plus missing relay is a loud error. Same-realm fallback is reserved for environments with no Worker route.
- Entry resolution, stdio planning, and public IPC capability each have one shared boundary; spawn and fork do not grow sibling implementations.
- Validate all stdio before process allocation so unsupported inputs cannot leave half-spawned children.
- Public Node IPC exists only for fork. Internal control is a separate capability and is not surfaced as `process.send`.
- Worker exit owns complete record/listener/channel/network teardown before replacement readiness.

## Reversibility

IRREVERSIBLE — widens the public `@riftydev/runtime-js` child-process contract and the kernel Worker/process channel contract, including filesystem provenance, stdio, IPC capability, and lifecycle behavior. Governed by ADR-0202.
