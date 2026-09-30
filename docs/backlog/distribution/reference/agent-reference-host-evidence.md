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

## Implementation evidence (in progress)

Source host recipe GREEN2: original manifest/lock/execution assertions now bind
to the real host; same-ID reopen retains source/manifest and makes no second
fetch. A real EISDIR write after successful apply leaves the ID truthful; same-ID
retry still restores desired bytes and installs.
`/tmp/rifty-pr357-reference-reopen-retry2.log`. Source fixtures gained direct
workspace SDK/Workbench dependencies, no source alias or product stub.

Benchmark config/report identity: differing no-COI policies RED1, then shared
comparison/config/structural guards GREEN18. Optional policy values are recorded
without a second enforcement engine; defaults100/600 match the session.
`/tmp/rifty-pr357-reference-policy-report-red.log`,
`/tmp/rifty-pr357-reference-unit-final.log`.

Actual packed benchmark services smoke PASS (167 real installed dependency
versions): default file write + Node execution; opt-in file/shell denial and
text-only native HTTP. No runtime SW during agent turns.
`/tmp/rifty-pr357-reference-bench-smoke2.log`.

Packed host journey passed both registry configurations on retained real
tarballs (`/tmp/rifty-pr357-reference-only7.log`): genuine Vite/agent edit,
install/no-registry, model switch, exact wire tool-call metadata, ordered build
output, busy retry, transcript/trace download, reopen/deploy/occupied retry.
Fresh full packed lane and final gates still required.

Carrier corrections: the controlled build HTTP response must be fully consumed
(`.text()`), per the existing fetch-keepalive body lifetime; an unread Response
held the fixture at the existing drain cap. No runtime change. JSON DOM projection
is compared with native JSON serialization (undefined fields omitted), not a
structured-clone object's undefined properties. Initial full packed attempt was
interrupted at that fixture wait; no passing claim from it. Regenerated native
snapshots for isolated replay because their real tarball URLs name the original
loopback registry; never redirected/faked the installer.

Required benchmark baseline repair: moving boot to the no-SW commands host
removed the old preview registration. Actual fix-date-sort/no-COI CLI probe
reproduced preview→#root timeout; trace/report under
`/tmp/rifty-pr357-bench-preview-red/`, log with same basename. The benchmark now
registers the same public SW only when preview is requested, outside host.ts.
Enhanced packed smoke uses genuine pinned Vite archives and passes actual iframe
preview plus default/policy/text-only cases (1.2min);
`/tmp/rifty-pr357-reference-bench-preview-green.log`. Shared registry fixture
extracted unchanged from the existing packed driver, with original byte/integrity
checks intact. This smoke is now invoked by the default full packed-consumer CI
lane, not only its diagnostic command. Same full CLI baseline rerun follows.
