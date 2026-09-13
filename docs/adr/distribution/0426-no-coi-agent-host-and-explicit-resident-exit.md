# ADR 0426: No-COI agent host and explicit resident exit

Status: Accepted
Date: 2026-09-12

## Context

Goal ai-agent-mode-and-bench I3/I6 requires the Pi loop over the existing
no-COI project API (ADR-0418), including host-owned build ↔ preview transitions.
ADR-0377 restart deliberately relaunches the resident. The public resident
handle has no exit; raw FS would bypass the accepted project policy.

## Decision

1. `createSandboxAgentHost({sandbox, project, mode, preview?})` in the agent
   package creates one public `sandbox.project(project)` handle. `project.root`
   anchors and bounds file tools; readonly/command policy remains SDK-owned.
   Reads/list/write/remove use only project.fs. Ordinary read-transform-write
   keeps the SDK's non-transactional semantics; no invented CAS or host lock.
2. The caller's `mode()` is the sole mode authority. Commands mode offers files
   and shell; preview mode offers only the supplied preview capability. Absent
   diagnostics/SCM stay absent. Native Pi refreshes tools/prompt before each
   model turn (ADR-0424). A stale in-flight tool reaches the SDK's loud admission
   failure; the adapter never falls back to raw FS or auto-switches modes.
3. Shell maps public run/onOutput/completion; abort calls stop and awaits its
   actual completion. Preserve status, effects and Worker replacement verbatim.
   No command replay. Host closure owns no sandbox lifetime; consumer disposes it.
4. Add `ToolchainSandbox.stopResident()`: explicit whole-Worker replacement,
   restore existing activation/files, clear resident intent and return the same
   `{unflushedWrites,resident:null}` report. Host clears its preview element.
   Even without an active resident this is an explicit replacement. Existing
   restart retains its replay/callback/preview behavior. Both use its current
   generation guard, lifecycle events, dirty marker and recovery owner.

## Mechanism sweep and alternatives

- SDK `restarting`, activation snapshot and dirty marker (`sandbox.ts`), Worker
  admission (`no-coi-project-command.ts`) and project Stop (`sandbox-project.ts`)
  already own all coordination. Factor one replacement body; add no scheduler,
  mode state, retry, journal or second generation lock.
- Minimal adapter over public project plus explicit resident exit: chosen.
  Executed baseline in `no-coi-resident-exit.spec.ts` reaches real HTTP preview,
  proves restart relaunch, then fails at missing `sandbox.stopResident`.
- Dispose/reboot in every embedding: killed by the same-object project handle
  and activation recovery requirement; it would duplicate ADR-0377's owner.
- Graceful server close or concurrent finite operations: would require a new
  resident protocol and coexistence semantics; not needed for accepted host modes.
- Raw FS plus separately filtered writes: killed by the accepted no-bypass
  policy and ADR-0418's Node/builtin/redirection policy seam.

## Consequences

AI remains outside SDK/runtime. No new external dependency; agent gains its
declared SDK type dependency. Preview exit replaces the realm, so only existing
acknowledgement/recovery guarantees apply; unflushed writes stay explicit.
Ordinary file tools do not turn a trusted SDK host into a hostile-code jail.
