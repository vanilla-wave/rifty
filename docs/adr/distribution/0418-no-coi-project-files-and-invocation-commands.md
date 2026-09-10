# ADR 0418: No-COI project files and invocation commands

Status: Accepted
Date: 2026-09-10

## Context

PR #331 / issues #325–326 require typed filesystem tools and cancellable method
calls on the existing no-COI Worker. ADR-0131 owns raw FS paths; ADR-0375/0376
own Worker composition/admission; ADR-0377 owns replacement and recovery.
Original scope and user answer: docs/backlog/distribution/reference/issues325-326-refine-evidence.md.
Reference/RED: docs/backlog/distribution/reference/pr-331-implementation-evidence.md.

## Decision

1. Extend RuntimeFs with readdir/stat/mkdir/rename/rm/flush. Preserve root anchoring,
   auto-parent writeFile and its Promise<void>. New mutation/barrier receipts
   carry applied yes and persistence memory/flushed. Failure effects distinguish
   no/yes/unknown application and failed/unknown persistence. A flush checks
   PersistFailureReport.total; no reply is proof of no effect.
2. ToolchainSandbox.project({root, readonlyPaths?, allowedCommands?}) binds an
   immutable file/command configuration. Relative file paths/cwd anchor at root;
   absolute paths retain their VFS meaning. Calls default cwd root and env {}.
   Root is a path origin, not a filesystem jail. This is project configuration, not a persistent Shell instance.
   project.fs uses the same operations; readonly applies to ordinary guest FS,
   builtin mutations and redirections, including destructive protected ancestors.
3. project.run(command, {cwd?, env?}) returns an invocation handle: onOutput,
   completion and stop. Completion carries status exited/cancelled/failed,
   exitCode or null, stdout/stderr, effects, Worker retained/replaced/terminated,
   and error on failure. Stream frames carry the existing request id. Install,
   project FS and commands share the existing Worker busy slot; no queue.
4. Existing Shell interprets each call. Its actual command-dispatch seam enforces
   allowedCommands; every bare background operator is rejected before launch.
   Installed bins, node and npm run reuse existing interpreter/Node entry code.
   No background-job admission is offered. Existing unsupported syntax stays loud.
5. Stop signals the active handler, retaining ownership through real handler,
   drain and checked flush settlement. Host fallback after one second of an
   admitted stopped invocation physically terminates the Worker and uses the
   existing restart owner. Completion reports replacement and unknown effects;
   recovery failure reports terminated. No replay, rollback, fresh-realm-per-call
   or hostile-JS containment promise. Memory recovery retains existing snapshot
   limits; filesystem receipts must not leave stale rename/remove snapshot entries.
6. Console eval prints expression values and returns value undefined. It does not
   gain structured evaluation or Stop. During an owned command, eval/raw FS cannot
   enter its active command policy/output context. Existing resident-concurrency rejection
   remains in force.

## Mechanism sweep and alternatives

- Keep existing Worker request ids, busy admission, realm transition guard and
  Sandbox restart; widen their coverage. No second scheduler or transport retry.
- Per-call Worker: killed by ADR-0376 and the required shared file authority;
  native busy-Worker probe proves a new realm is necessary only on forced Stop.
- Host-only filtering plus Shell mutationGuard: killed by the ordinary Node
  write scenario; node:fs resolves syncMirror directly. One permanent FsSync policy view
  wraps the existing install-claim mirror before loaders/adapters capture it.
- Full Workbench facade: killed by no-COI topology (ADR-0375/0377).
- Signal then immediate terminal result: killed by pending handler/flush Stop
  scenario. Existing awaitAbortSettlement plus physical replacement owns the edge.

- Per-call virtual root/syncMirror replacement: rejected at PICKUP. Existing
  esbuild runtime captures physical FsSync/cwd and refuses a second start
  (runtime-adapters.ts:108, generated/esbuild-runtime.js:1960). Keeping the same
  physical paths and mirror preserves the adapter authority and Node ancestor
  lookup. This changes our proposed carrier, not the accepted user scenario.

## Consequences

Public types expand additively. Raw FS remains the trusted host control plane;
project policy constrains ordinary operations, not malicious guest globals.
Finite operations preserve filesystem effects; killed memory realms may lose
unacknowledged effects. Errors and completion expose this uncertainty.
