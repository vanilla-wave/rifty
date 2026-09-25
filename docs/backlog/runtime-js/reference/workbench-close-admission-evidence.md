# Workbench close admission repair

Delivery: PR351 post-CLOSE verification discovery; goal contracts retained at
f98099bf7. Authority: existing companion browser test, ADR-0319/0278 close order.
No new user scope or feature promise.

## Baseline / RED

CI36135609681 @b0b54f6ab: browser-unit337PASS/1FAIL/1SKIP. Failing case:
`tests/browser-unit/workbench-playground-companion.spec.ts:928`, real instant
Vite port5174 and Workbench.close over its open session. Aggregate contains
inactive project token followed by owner SIGTERM, at4.0s; not timeout.

`RIFTY_PLAYGROUND_PORT=5507 pnpm exec playwright test --config playwright.browser-unit.config.ts tests/browser-unit/workbench-playground-companion.spec.ts`
→5PASS/1FAIL12.6s, same error. Log `/private/tmp/rifty-final-ci-companion-isolated.log`.
Earlier identical product source f980/06e had green complete CI; that history
does not invalidate the reproduced ordering defect or authorize a blind retry.

## Root owner

ProjectSession waits beforeClose hooks (companion tools lifecycle), then invokes
core/content/terminal/runtime/project-close operations. Workbench's independent
one-microtask preflight guess starts physical owner shutdown earlier. Owner
fences/retires the token; late project-close fails; its recovery kills owner.
Repair the lifecycle admission seam, not the downstream error classifier.
ADR-0468 records the smallest mechanism and rejected alternatives.

## Fault matrix

| axis / operation | required behavior | carrier | trace |
|---|---|---|---|
| observable-order / hook vs owner shutdown | hooks settle, all core closes invoked, then owner shutdown | deterministic admission guard + real companion case | → ADR-0319, ADR-0278 |
| torn-state / dirty preflight and retry | no hook/core/owner close on veto; later clean attempt admits | existing dirty-close/retry controls | → ADR-0273, ADR-0319 |
| liveness / admitted VFS close | owner teardown may cancel work after admission; full project settlement not prerequisite | existing owner-cancels-project close control | → ADR-0319 |
| failure attribution / hook or core close failure | attempt siblings; preserve original failure; no broad cancellation mask | deterministic failure controls | → ADR-0278 |

## Executed repair

Existing private closeInternals authority now exposes its per-successful-close
admission Promise. Workbench uses that causal signal rather than one microtask;
no public API, registry, timeout or downstream error classifier changed.

New `workbench-close-admission.spec.ts` crosses real Workbench/owner RPC:
fulfilled hook, failed hook, dirty-preflight then retry. All3RED before fix:
owner retired while hook pending. Fresh5509 new3 + unchangedcompanion6 →9/9PASS
14.2s; original Vite casePASS1.7s. Failed-hook identity and successful owner
termination remain asserted; dirty retry keeps actual owner alive until release.

ProjectSession/openWorkbench/companion facade unit122PASS; no-hooks admission
settles while a terminal close is still pending, dirty veto has no admission,
hook failure still attempts core siblings. Workbench typecheck/architecture/
size/BiomePASS. Logs `/private/tmp/rifty-close-admission-{red,unit,browser-green,types,arch,size}.log`.

Full PR gate and independent post-CLOSE verify remain required. Earlier Final
atf980 is historical; this production change requires a new bound verdict.

## Revert and merged verification

Fresh5510 literal revert restores only the old microtask rule through a scratch
Vite pre-transform at the original module identity. Unchanged fulfilled-hook
browser guard turns RED: owner closed before release and RPC read lost. No
tracked source/assertion/timeout edits. Initial alias setup failure (duplicate
private WeakMap identity) is excluded from proof; the corrected run is
`/private/tmp/rifty-close-admission-revert/red.log`. Server stopped afterward.

Main99fdf6c91 (agent history) merged in1179ddfd4; only ADR-index conflict,
both0466/0468 retained. All59 source/test files cited by214review rows unchanged
from8573. Exact merged-head `pnpm pr:check`25/25PASS (unit220.7s/parity86.3s),
packedconsumerPASS187.7s, fresh5511 originalVitest10runsPASS46.7s.
Logs: `/private/tmp/rifty-close-admission-merged-pr-check.log`,
`/private/tmp/rifty-close-admission-packed.log`,
`/private/tmp/rifty-close-admission-vitest.log`.
Independentreview:214/214coverage,165independenttestsPASS; onlyCI/rebinding
verification remains at this record. CI36139754267 targets exact1179ddfd4.

Exact1179 CI36139754267 completedSUCCESS:19/19jobs, browser-unit108086559627
included. Independent merged-source Final covers214/214rows; canonical verdict
`vitest-delivery-final-green.json`. Final packaging changes evidence only.
