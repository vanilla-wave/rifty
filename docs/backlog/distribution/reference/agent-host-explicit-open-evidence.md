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
