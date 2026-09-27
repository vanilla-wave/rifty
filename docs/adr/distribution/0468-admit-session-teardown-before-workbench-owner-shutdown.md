# ADR 0468: Admit session teardown before Workbench owner shutdown

Status: Accepted
Date: 2026-09-25

## Observed defect

CI36135609681 and fresh isolated Chromium5507 reproduce the existing instant
Vite companion close test failure: late close-project receives inactive-token,
then its failure path kills the owner with SIGTERM. CI337PASS/1FAIL; isolated
file5PASS/1FAIL. This is not a timeout or a speculative flake repair.

ProjectSession awaits companion beforeClose hooks before starting core teardown
(ADR-0319, ADR-0278). Workbench inferred successful close admission after one
microtask, then started owner shutdown while those hooks were still pending.
A local proof at each side did not establish the required cross-owner ordering.

## Decision

Supplement ADR-0319 and ADR-0278; preserve their existing close order.

- The existing private ProjectSession closeInternals WeakMap carries a per-close
  admission signal. Create it only after clean preflight succeeds. Resolve only
  after all beforeClose hooks settle and content/terminal/runtime/closeOwner
  operations are synchronously invoked, before awaiting their completion.
- Workbench's existing ActiveProjectClose preflight projection consumes that
  signal for real owned sessions. Do not substitute one microtask for lifecycle
  evidence. Existing externally supplied session adapters keep their fallback;
  they have no private companion hook owner to observe.
- Owner shutdown begins after admission, never after full session settlement.
  Pending handed-off VFS work can still be cancelled by physical owner teardown.
- Dirty preflight remains retryable; hook/core failures remain exact and are
  aggregated after every teardown sibling is attempted. Repeated close keeps
  one settlement. No new public API, timeout, token exception or error masking.

## Mechanism sweep / alternatives

Reuse ProjectSession's existing weak authority and deferred settlement plus
Workbench's existing preflight gate. Other Workbench states (opening/deleting)
have no admitted session hooks and retain early owner cancellation. No global
registry, per-key queue or second shutdown owner.

Rejected: await full session.close (can deadlock waiting for owner disconnect);
add sleeps/more microtasks (not causal ordering); treat inactive-token/SIGTERM
as success (hides incomplete teardown). A pending companion hook already blocks
standalone session close; Workbench now respects that same ordering rather than
retiring its owner prematurely.

## Proof required

The unchanged real companion browser case is the baseline RED. Deterministic
hook admission, dirty retry, failure propagation and post-admission cancellation
controls cross the actual lifecycle seam. Final native browser/gates and an
independent verify bind this post-CLOSE repair before delivery.

Executed: deterministic real-browser3RED→3GREEN; unchanged companion6GREEN
onfresh5509, including original Vite failure.122unit, Workbench typecheck,
arch/size/BiomePASS. Evidence: ../../backlog/runtime-js/reference/workbench-close-admission-evidence.md.
