# No-COI sandbox tier — closure evidence (2026-09-04)

Product tree: `b673665c3`; re-chart bookkeeping: `03cea0c0b`.
Node 24.16.0, Playwright 1.60.0, Chrome 148.0.7778.96.

## End-to-end proof

```sh
pnpm test:no-coi --reporter=line
# 38 passed (2.4m)

pnpm exec playwright test --config playwright.browser-unit.config.ts \
  tests/browser-unit/opfs-no-coi-policy.spec.ts \
  -g "no-COI capable dedicated Worker selects OPFS and survives exact-byte reload" \
  --workers=1 --reporter=line
# 1 passed (4.8s)

pnpm pr:check
# 24/24 PASS; test:run 320.0s; parity 80.0s
# public-snippets + node-parity-runner timed out in aggregate, then both
# passed the gate's required isolated file rerun
```

`playwright.no-coi.config.ts` serves the SDK harness without COOP/COEP and
serially runs `tests/no-coi`. `.github/workflows/ci.yml` requires both
`no-coi-chromium` and `browser-unit-chromium`; the I5 carrier strips both
headers for its initial navigation and reload.

| invariant | real-browser carrier |
|---|---|
| I1 | public literal-false admission and exact frozen capability report in `no-coi-sandbox-build-loop.spec.ts` |
| I2 | real Vite 7 dependency install in the public build-parity scenario |
| I3 | same scenario reads byte-identical no-COI and COI product `dist/` |
| I4 | `no-coi-dev-hmr.spec.ts` loads real Vite preview and observes stable-bootId HMR |
| I5 | `opfs-no-coi-policy.spec.ts:332` flushes, reloads, boots a fresh Worker and reads exact bytes |
| I6 | real plugin wedge, explicit restart/iframe reload, resumed HMR and actual `self.close()` event |
| I7 | real same-realm spawn stdout/stderr, warn-once, loud `execSync`, CPUs=1 in the capability scenario |
| I8 | required Chromium jobs above execute I1-I7/I9/I10 on pages observed non-COI |
| I9 | second-origin opener/cookie/subresource samples stay non-COI before, during and after install/build |
| I10 | pending and acknowledged writes produce dirty and clean restart markers |

Final dev-HMR review at `b673665c3`: 0 blockers, 34 pass / 7 weak / 0
missing. Four weak concerns were advisory under REV-3/REV-4 and are dropped,
not residuals: ordinary-bin Worker-count symmetry, post-dispose event
observation, whole clean-report exactness and unowned registry callback arity.
The prior ledger's shorthand that no traced clause required any of them was
imprecise; the calibrated reason is `weak`, not `missing`.

## Ledger and fog export

Pre-close ledger lines 3-9 are carried by this record, ADR-0372/0375/0377 and
the three `no-coi-*spike-record.md` / `sw-coi-shim-probe.md` records. Lines
10-22 are carried by the named runtime-js/VFS sources, tests and ADR-0372.
Lines 23-127 are carried by ADR-0375/0376, the packed fixture,
`no-coi-sandbox-build-loop.spec.ts` and the retained slice evidence records.
Lines 128-132 are carried by `no-coi-host-posture-preservation-evidence.md`.
Lines 133-159 are carried by ADR-0377/0378/0379,
`no-coi-dev-hmr-restore-evidence.md` and `no-coi-dev-hmr.spec.ts`.

Within those ranges, bands, intermediate blockers, pending statuses, obsolete
frontiers and superseded commit mappings are dropped as run history; final
PASS records and git retain their audit trail. The map ended with no item and
no fog. Its live external scopes remain `kernel/process-equals-web-worker`,
`distribution/iframe-embed`, ADR-0165 and the declined-concepts rows.

Metric direction: no-COI vs COI single-worker build lanes were
noise-indistinguishable; single-worker vs old product composition improved,
but that is not an isolation win. HMR 100/100 and p50 244 ms are historical
viability observations, not a before/after improvement claim. Current closure
claims correctness only.

Residuals: unit 0; goal 0; outside-goal discoveries 0.
