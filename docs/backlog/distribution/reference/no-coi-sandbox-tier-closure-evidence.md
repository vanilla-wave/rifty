# No-COI sandbox tier — closure evidence (2026-09-04)

Product tree: `b673665c3`. Final I8 proof tree: `b7fd5802f`; re-chart:
`6320e34a8`. Node 24.16.0, Playwright 1.60.0, Chrome 148.0.7778.96.

## End-to-end proof

```sh
pnpm test:no-coi --reporter=line
# 39 passed (3.7m); I5 is test 18/39 in the same lane

pnpm exec playwright test --config playwright.browser-unit.config.ts \
  tests/browser-unit/opfs-no-coi-policy.spec.ts --workers=1 --reporter=line
# 7 OPFS preservation/fault siblings passed (4.8s)

pnpm pr:check
# 24/24 PASS; test:run 219.4s; parity 76.7s
```

Remote `no-coi-chromium` passed 39/39 at `b7fd5802f`. The ordinary proof-only
review at that SHA found product delta 0, coverage 3/3 pass and no findings.
The prior dev-HMR Final+GREEN at `b673665c3` found 0 blockers and 0 missing
coverage.

| invariant | real-Chromium carrier in the 39-test no-COI lane |
|---|---|
| I1 | literal-false public admission plus exact frozen capability report |
| I2 | real Vite 7 dependency install through the public sandbox Worker |
| I3 | agent write/build/read with byte-identical no-COI and COI `dist/` |
| I4 | real Vite preview and stable-bootId HMR after acknowledged write |
| I5 | `no-coi-opfs-reload.spec.ts`: clean flush, full page reload, fresh Worker, exact bytes |
| I6 | real plugin wedge, explicit restart/iframe reload, resumed HMR and actual death event |
| I7 | real same-realm stdio, warn-once, loud `execSync`, CPUs=1 |
| I8 | one required `no-coi-chromium` job executes all rows above plus I9/I10 |
| I9 | header/opener/cookie/subresource posture before, during and after install/build |
| I10 | pending and acknowledged writes produce dirty and clean restart markers |

Four dev-HMR weak concerns remain advisory under REV-3/REV-4, not residuals:
ordinary-bin Worker-count symmetry, post-dispose event observation, whole
clean-report exactness and unowned registry callback arity. The old ledger
line 158 called them untraced; line 161 corrects that shorthand — dispose
silence is traced, but its carrier was graded weak rather than missing.

## Exhaustive ledger export

Snapshot before deletion: 171 lines, bullet entries 3–171. Ranges below are
disjoint and exhaustive. `carrier` means this reference preserves the range's
run history and the listed durable artifacts resolve its technical claims;
no ledger entry is also dropped.

| ledger lines | disposition | durable resolution |
|---|---|---|
| 3–9 | carrier | scope/refit decisions plus `no-coi-build-spike-record.md`, `no-coi-hmr-spike-record.md`, `no-coi-degradation-probes.md`, `sw-coi-shim-probe.md` |
| 10–13 | carrier | SAB-less realm source/test and `worker-realm-compat-no-coi.spec.ts` |
| 14–17 | carrier | same-realm stdio source tests and Node parity cases |
| 18–22 | carrier | ADR-0372, `no-coi-opfs-reload.spec.ts`, OPFS preservation siblings |
| 23–44 | carrier | ADR-0375, packed fixtures and build-loop evidence; intermediate split/checkpoint state superseded by its recorded PASS |
| 45–53 | carrier | bounded-cause source/tests, packed fixture and Final PASS |
| 54–62 | carrier | ADR-0375 and descriptor-evaluation split evidence |
| 63–70 | carrier | native descriptor source/unit/no-COI tests and Final PASS |
| 71–87 | carrier | build-loop evidence, ownership split and final route decisions |
| 88–109 | carrier | public admission source/tests, exact review lineage and landed PASS |
| 110–115 | carrier | ADR-0376 plus lifecycle evidence and PASS |
| 116–120 | carrier | package-install evidence, public Chromium/npm tests and PASS |
| 121–127 | carrier | build-loop evidence, exact bytes and ordinary PASS |
| 128–132 | carrier | host-posture evidence, four-phase browser carrier and ordinary PASS |
| 133–159 | carrier | ADR-0377/0378/0379, dev-HMR evidence/spec and Final PASS |
| 160–171 | carrier | formal closure audit, CI proof evidence, outside process finding, ordinary PASS and final re-chart |

The ranges carry historical bands, blockers, stops, superseded frontiers and
commit mappings as history; their final PASS in the same range resolves each.
No active unit or goal residual remains.

## Map and rejection export

Map Items and Open questions were both empty; therefore no fog trigger exists.
Every Out-of-scope row has one durable carrier:

| map lines | carrier |
|---|---|
| 20 | capability report plus loud `execSync` no-COI test |
| 21–24 | ADR-0375 and real Vite 8/threaded-WASM named-boundary test |
| 25–28, 44–47 | SW probe plus declined SW-delivered-COI row |
| 29–31 | `kernel/process-equals-web-worker` |
| 32 | `distribution/iframe-embed` |
| 33–38 | ADR-0377 plus declined heartbeat/journal row |
| 39–42 | ADR-0375 plus declined Vite-identity-policy row |
| 43 | ADR-0165 |

Metric direction: no-COI vs COI single-worker build lanes were
noise-indistinguishable. Single-worker vs the old product composition improved,
but that is not an isolation win. HMR 100/100 and p50 244 ms remain historical
viability observations, not a before/after improvement claim.

Residuals: unit 0; goal 0; outside-goal 1, captured as
`process-meta/ordinary-proof-only-ready-gate-conflict`.
