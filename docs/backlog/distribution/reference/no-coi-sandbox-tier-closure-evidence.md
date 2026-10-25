# No-COI sandbox tier — closure evidence (2026-09-04)

Product tree: `b673665c3`. I8 proof: `b7fd5802f`. Closure export proof:
`c6d8b480b`. Declined-route proof: `bc03d1e10`; final re-chart:
`8675e3eb6`. Node 24.16.0, Playwright 1.60.0, Chrome 148.0.7778.96.

## End-to-end proof

```sh
pnpm test:no-coi --reporter=line
# 39 passed (3.7m); I5 is test 18/39 in the same lane

pnpm exec playwright test --config playwright.browser-unit.config.ts \
  tests/browser-unit/opfs-no-coi-policy.spec.ts --workers=1 --reporter=line
# 7 OPFS preservation/fault siblings passed (4.8s)

pnpm pr:check
# final reviewed tree: 24/24 PASS; test:run 186.8s; parity 75.0s
```

Remote `no-coi-chromium` passed 39/39 at `b7fd5802f`. I8 ordinary review:
3/3 pass, no findings. Closure-export review at `c6d8b480b`: 2/2 pass, no
findings. Exhaustive ADR/pickup rejected-route review at `bc03d1e10`: 28/28
pass, no findings. All three report product/test delta 0. Dev-HMR Final+GREEN
at `b673665c3`: 0 blockers and 0 missing coverage.

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
clean-report exactness and unowned registry callback arity. Pre-close ledger
line 158 called them untraced; line 161 corrects that shorthand — dispose
silence is traced but graded weak rather than missing.

## Exhaustive ledger export

Snapshot before deletion: 186 lines, bullet entries 3–186. Ranges below are
disjoint and exhaustive. `carrier` means this reference preserves the range's
history and the listed durable artifacts resolve its technical claims. No
ledger entry is dropped or assigned twice.

| ledger lines | disposition | durable resolution |
|---|---|---|
| 3–9 | carrier | scope/refit decisions, exact risks below, build/HMR/degradation/SW records |
| 10–13 | carrier | SAB-less realm source/test and `worker-realm-compat-no-coi.spec.ts` |
| 14–17 | carrier | same-realm stdio source tests and Node parity cases |
| 18–22 | carrier | ADR-0372, `no-coi-opfs-reload.spec.ts`, OPFS preservation siblings |
| 23–44 | carrier | ADR-0375, packed fixtures and build-loop evidence; its PASS resolves intermediate state |
| 45–53 | carrier | bounded-cause source/tests, packed fixture and Final PASS |
| 54–62 | carrier | ADR-0375 and descriptor-evaluation split evidence |
| 63–70 | carrier | native descriptor source/unit/no-COI tests and Final PASS |
| 71–87 | carrier | build-loop evidence, ownership split and final route/risk decisions |
| 88–109 | carrier | public admission source/tests, exact review lineage and landed PASS |
| 110–115 | carrier | ADR-0376 plus lifecycle evidence and PASS |
| 116–120 | carrier | package-install evidence, public Chromium/npm tests and PASS |
| 121–127 | carrier | build-loop evidence, exact bytes and ordinary PASS |
| 128–132 | carrier | host-posture evidence, four-phase browser carrier and ordinary PASS |
| 133–159 | carrier | ADR-0377/0378/0379, dev-HMR evidence/spec and Final PASS |
| 160–171 | carrier | first close audit, I8 proof evidence, process finding, ordinary PASS/re-chart |
| 172–176 | carrier | second close audit, export evidence, ADR-0378 rows, ordinary PASS/re-chart |
| 177–186 | carrier | final close audit, exact risk/gap carriers, full declined union, ordinary PASS/re-chart |

Exact one-off carriers:

- ledger 7: `util-types.ts:27,31` are TypeScript predicate positions erased at
  runtime; adjacent runtime checks compare brand strings. No bare
  `SharedArrayBuffer` global read or product gap exists.
- ledger 9/87: adopter demand stayed unquantified and opportunity cost against
  M11 unresolved; the user accepted that premise risk on 2026-08-31. It is a
  decision risk, not a product-impact claim.

Historical bands, blockers, stops, superseded frontiers and commit mappings
stay history inside their one range; each range's final PASS resolves them.
No active unit or goal residual remains.

## Map and rejection export

Map Items and Open questions were empty; no fog trigger exists. Every
Out-of-scope row has one disposition:

| map lines | disposition |
|---|---|
| 20–22 `execSync`/`spawnSync` | carrier: named `execSync` test; absent `spawnSync` in `runtime-js/node-builtins-loud-stub-capability-gaps` |
| 23–26 | carrier: ADR-0375 plus Vite 8/threaded-WASM named-boundary test |
| 27–30, 46–49 | carrier: SW probe plus separate declined SW/docs-site rows |
| 31 `ring-less spawn` | dropped: outside tier `works`; no code/spike; kernel backlog retains isolation scope |
| 31–32 `async remote-fs` | dropped: outside goal; no trigger, code or spike |
| 31–32 `snapshot children` | dropped: outside goal; no trigger, code or spike |
| 32–33 `sync-XHR-to-SW` | dropped: zero code/spike; goal chose one in-realm Worker |
| 34 | carrier: no own origin prevents same-origin SW preview; hosted route stays `distribution/iframe-embed` |
| 35–40 | carrier: ADR-0376/0377 plus separate heartbeat/reconnect/journal/retry/exactly-once/queue/crash rows |
| 41–44 | carrier: ADR-0375 plus separate Vite identity/finalizer rows |
| 45 | carrier: ADR-0165 |

`no-coi-declined-concepts-export-evidence.md` records the complete
ADR-0372…0379 and pickup union. Declined concepts has one row per route;
ordinary review verified all 28 rows with no finding.

Metric direction: no-COI vs COI single-worker build lanes were
noise-indistinguishable. Single-worker vs the old product composition improved,
but that is not an isolation win. HMR 100/100 and p50 244 ms remain historical
viability observations, not a before/after improvement claim.

Residuals: unit 0; goal 0; outside-goal 2 — captured ordinary-ready gate
conflict and `spawnSync` loud-gap update.
