# ADR 0539: Serve no-COI child filesystem calls through Service Worker

Status: Accepted
Date: 2026-10-20

## Context

SAB is unavailable; a native child Worker cannot synchronously wait on a
MessagePort. A filesystem snapshot loses Node's live shared-store semantics.
Chromium 148 spike proves synchronous XHR → SW → controlled Window → VFS owner
without COI: `docs/backlog/runtime-js/reference/no-coi-child-processes-spike.mjs`.

## Decision

1. User accepted: «child_processes требуют SW; остальные функции без SW сохраняются».
   No-COI Node children require a controlling rifty SW; missing bridge is
   `NotImplementedError('child_process.spawn.service-worker')`. Other no-SW
   SDK operations retain their behavior. This supersedes the no-COI toolchain
   same-realm fallback only; COI routing is unchanged.
2. Native Worker owns the child's module loader, process and globals. Existing
   Node runtime and FsSync RPC semantics remain the authority. Kernel dispatcher
   exposes transport-independent dispatch; SAB and SW invoke the same handlers.
3. SW forwards opaque binary RPC frames to the explicit Window client and
   sandbox token. One transferred reply port per request; no SW routing table,
   retry, snapshot or new VFS. Window forwards to the live owner. A dead route
   fails loudly; a timeout never claims a mutation was not applied.
4. Child async stdio and terminal frames share one private ordered output/control
   port; stdin has its own port. ProcessManager retains PID/exit/kill ownership.
   No SAB output counter is carried into this transport. Handler producers publish
   completion through `ProcessIO.complete(code)`, the existing manager transition.
   Physical child routes reuse kernel federation for nested PID/control identity;
   the live owner binds each route token to its existing caller context. Process
   and readable-pipe references are independent, as Node's `unref` requires.
   Outgoing port forwarding exists before the child is returned; send/disconnect
   share the same microtask order. Incoming IPC uses the existing ProcessHandle
   events, distinguishing child disconnect from a parent request.
   Node 24.16.0 emits exit but omits close after parent disconnect; the shared
   ChildProcess preserves that observed behavior (`parent-disconnect-close` parity).
5. The Workbench no-COI Worker entry selects owner/child bootstrap. SDK retains
   bridge ownership through restart/disposal. File operations use the owner's
   current project policy and ordinary persistence/flush path.
   Invocation teardown applies the kernel's existing descendant-retirement policy,
   so an idle unref'd service cannot mutate the next reused invocation.

6. No-COI installed esbuild uses the untouched esbuild-wasm Node entry, selected
   by the existing toolchain-realm marker; COI retains its registry runtime slot.
   Registry `./runtime/common` exposes ordinary preparation without importing the
   COI generated client. Exact installation admission remains unchanged.
   This supersedes ADR-0384/0226 bundled-client startup for no-COI only, per the
   explicit user decision; their COI behavior remains.

## Consequences

- Upstream Node helpers can load unmodified packages and share live files.
- SW control is a deployment prerequisite only for these children; no new URL
  configuration or COOP/COEP requirement.
- Child filesystem calls wait while the owner executes synchronous guest code.
- Native Worker/SW failure is loud at tier works; no retry/durability inference.
- Snapshot mirror rejected (live FS); OPFS mailbox rejected (storage dependency
  and polling); QuickJS rejected (new guest-engine/WASM semantics). Independent
  premise critic checked these alternatives before the user's SW decision.
