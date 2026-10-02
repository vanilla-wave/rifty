# PR357 — explicit reference host preparation

BASE45bc326ab4e3221c6e2beea61d35ab0b221771f7. User amendment2026-10-01:
«давай явно выпилим ее из этого ПРа» — identity → force → reconciliation.
Authority: amended no-coi-agent-host-kit-close.md + ADR-0490.

Scope: remove host applied-ID state, implicit force and deployment reconciliation;
keep initial explicit preparation, saved open, SDK validation/conflict/explicit force,
agent install and shared benchmark composition. No replacement marker/state owner.

Preparation: independent DEC-2 snapshot_scope_decision accepted the explicit
prepare/open route; ordinary producer-vite-update remains existing SDK proof.
Chromium reference-host-open.spec.ts RED on BASE: first prepare throws
“Connect application snapshot storage before apply”. Real SDK/Worker/OPFS,
genuine producer/ms archive; only HTTP delivery controlled.
Command: RIFTY_NO_COI_PORT=5611 RIFTY_NO_COI_ORACLE_PORT=5612
RIFTY_NO_COI_RESOURCE_PORT=5613 pnpm test:no-coi tests/no-coi/reference-host-open.spec.ts.
Log: /private/tmp/rifty-pr357-remove-deploy-red.log.

Acceptance: initial apply needs no identity store; explicit saved open preserves
source/manifest/lock and executes the dependency without refetch; an explicitly
supplied conflicting snapshot fails without forcing or replacing saved sources;
shared packed host still covers both registry configurations and occupied retry.
Old deployment tests are removed by the explicit scope amendment, not retargeted
as proof of deployment. Historical verdicts remain historical.

Removal verification: source Chromium13/13 (new explicit-open case plus unchanged
SDK snapshot acceptance); benchmark boundary/config/comparison18/18; build:libs
passed. Logs /private/tmp/rifty-pr357-remove-deploy-{green,unit,build}.log.
User additionally requested independent arch-review and repair of every finding;
full PR verification follows the npm section/control-flow repairs it identified.

## Independent arch-review repairs

User requested a separate arch-review and all findings fixed. Reviewer
pr357_arch_review inspected the full PR plus removal, found F1/F2/F3; removal
scope and architecture accepted. Its final report remains in the session.

F1/F2: npm section saves and root edge precedence. Node24.16.0/npm11.17.0
native matrix56 plus9 controls, genuine ms/kleur HTTP archives. Shared shell
must retain optional on explicit -D and prefer dev when sections overlap.
Direct installer and Eddy share selectRootDependencyEdges; root lock maps
preserve native optional normalization. Named saves retain native range
intersection and explicit-star behavior. No new public API or state owner.
Boundary: owned in-process dependency-map projection, frozen-assumption /
sibling-drift / lossy-aggregate. Transport loss/duplication/reordering excluded
at this boundary; real registry and persistence behavior remain existing owners.
Sweep: installer-request and eddy-request select install edges. Legacy install
stamp's map is a separate byte-guarded freshness projection, not selection.

- RED shared/direct17 + real Eddy2 + Chromium2.
- GREEN focused115/115, Chromium35/35; npm-client/workbench typechecks + arch.
- Revert-check: shared/Eddy19 RED, Chromium14 RED; restored115 GREEN.
- Old eddy-request unit expected prod-over-dev; corrected against executed
  native oracle, not a self-derived implementation expectation.
Logs: /private/tmp/rifty-pr357-npm-{sections-red,eddy-red,browser-red,
final-green,browser-green,sections-revert,browser-revert,final-typecheck,arch}.log.

F3: run-wide registryFailure survived a recovered npm command and relabeled
any later nonzero result. Clear it at the existing actual-dispatch hook;
skipped branches keep the last executed command's cause. No Shell API change.
Boundary: owned in-process outcome projection, provenance-lie / observable-order.
Sweep: only no-coi-project-command retains this diagnostic; sequential buffered
pipeline and nested npm scripts share actual dispatch. Loss/reordering excluded.
Real Chromium RED3 → GREEN3 → revert RED3 → restored GREEN3. Cases: later
Node/false/unknown/redirection errors, short-circuits, nested scripts, pipeline
last-stage and Stop. Logs /private/tmp/rifty-pr357-f3-{red,green,revert,restored}.log.
