# Shared reference host — I8 preparation

BASEbecdaddfb1b35484a4c183a18556d7abe5a8d47f (accepted I9).
Goal scenario1–9/I8; ADR-0417/0420/0489. Earlier SDK/agent invariants and native
oracles remain accepted (goal ledger); only the private host recipe is new state.

Independent PICKUP/source-authority check `/root/reference_plan` inspected raw
user decisions, goal/map, actual packed/bench code and ADR0417: scope permitted,
no user fork. Report `/tmp/rifty-pr357-reference-plan-review.md`. Material facts:
- Actual desired manifest must come from the real post-agent project; pre-seeded
  ms cannot stand in for that transition. Existing producer-vite-update already
  contains ms; final recipe proof needs another deploy payload without it.
- Bench currently forwards40 calls, not reference100; copy/import wiring needs
  an executable packed benchmark smoke. No source-only closure.
- Host marker certifies apply only. Explicit files/install still run on matching
  ID, so a retry cannot hide a failed reconciliation. Reopen omits stale sources.

Real Chromium baseline RED: genuine producer snapshots A/B, genuine kleur tarball,
real shell npm install and successful require (4.1.5), then existing apply-only
consumer sequence force(B). Manifest and lock lose ^4.1.5; actual require still
works because untargeted files survive. Both dependency-map assertions RED;
execution is a control. This is missing host reconciliation, not an SDK force
bug. `/tmp/rifty-pr357-reference-deploy-red.log`; executable carrier
`tests/no-coi/reference-host-deploy.spec.ts`. No missing import/typecheck failure.

The final carrier binds the same inputs/preconditions/assertions to the new host
orchestration, replacing only baseline setup calls. Packed journey additionally
runs actual Pi edit/install/build and both registry configurations. No future
GREEN or whole-goal acceptance claimed at preparation.

Portable carrier rerun: `pnpm exec playwright test -c playwright.no-coi.config.ts
--project=chromium tests/no-coi/reference-host-deploy.spec.ts` → same behavioral
RED, manifest+lock undefined vs ^4.1.5; pre-install/use controls pass. Log
`/tmp/rifty-pr357-reference-committed-carrier-red.log`.

Mechanism sweep: SDK operation owner retains fail-fast busy (ADR-0376); agent
tool dispatch already sequences its work. Only the scenario9-authorized host
promise chain sequences that host's explicit prepare/call actions. It does not
queue agent calls, hold a namespace lease, or replace SDK busy enforcement.
