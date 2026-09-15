# ADR-0437: Bounded Workbench browser prerequisite probes

Date: 2026-09-15. Status: accepted.

## Context

PR #340 requests active browser diagnostics before opening, for both existing
compositions. ADR-0071 keeps SDK capability detection pure and synchronous;
ADR-0372/0375/0383/0419 own topology, VM and persistence. Native discriminators:
`docs/backlog/distribution/reference/workbench-sandbox-support-refine.md` and
`docs/backlog/distribution/reference/workbench-sandbox-support-csp-evidence.md`.
Worker presence survives CSP denial; WASM permission does not imply JS eval.

## Decisions

1. Workbench exports async `checkSandboxSupport(options?)`, plus report/options
   types. Report contains `checks`, `modes.coi`, `modes.nonCoi`, `cleanup`, and
   evidence limits. Check states: passed, failed, incomplete, not-applicable;
   mode conclusions: supported, unsupported, inconclusive. Unknown required
   operations prevent supported. Reasons include observed exception name/message;
   an empty Worker error never becomes an invented CSP diagnosis.
2. Caller supplies `probeBaseUrl` for the package's separately built inert probe
   assets. Omission reports incomplete asset-dependent checks. No host URLs are
   guessed. Module Worker, dynamic import and nested module Worker use these
   assets; actual application deployment/control remains unverified.
3. Options select persistence (required/preferred/ephemeral; default preferred),
   non-COI vmEngine (rewrite/quickjs; default rewrite), and optional WASM workloads.
   Requiredness follows existing composition operations; it is not a new boot gate.
   SDK's synchronous API remains unchanged, with passive semantics clarified.
4. One invocation owns its Workers, MessagePorts, random scratch directory and
   random SW scope. No Workbench origin lease, project namespace or existing SW
   registration is acquired/changed. SW asset has no fetch/claim/skipWaiting
   handlers; registration/activation proves capability, never deployment control.
5. One deadline owner bounds probe work and a separate bounded cleanup phase.
   Worker termination precedes scratch deletion. Uncancelable native operations
   retain late cleanup; timeout reports cleanup incomplete until actually observed.
   No cache, global registry, retry queue or correlation protocol.

## Alternatives and mechanism sweep

- Passive flags / startup-only: rejected by explicit user answers and native CSP
  discriminator; full disposable boot adds origin/session effects the requested
  prerequisite result does not need.
- Blob-only probes: smallest packaging interface, but cannot register an SW and
  tests blob CSP instead of the existing same-origin module Worker operation.
  Separate static probe assets cover these operations without real boot assets.
- Existing `workbench/service-worker-control.ts` owns real deployment control,
  listeners and its deadline; reusing it would require an actual controlling SW.
  `workers/owner-rpc-client.ts` and `workbench/project-content-transport.ts` own
  admitted application mutations; their timeout is not cancellation. These
  authorities cannot own disposable probe teardown. A per-invocation deadline
  is the minimal separate authority; no third coordination owner for any key.

## Consequences

Browser evidence is current-context and time-limited. It does not promise actual
asset configuration, future quota/durability, free origin leases or npm support.
Probe assets must receive the applicable CSP; deployment-specific differences
remain explicit. Non-COI does not enable `openWorkbench` without COI.
