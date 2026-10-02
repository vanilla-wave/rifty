# Vitest delivery execution evidence

2026-10-02; goal `vitest-run-in-browser`; delivery base `0c4c1b07`.
Node v24.16.0; native Vitest 4.1.11 / Vite 8.0.16; Chromium Playwright.
Original baseline and npm oracle: `vitest-run-in-browser-evidence.md`.

## RED and reference

Captured failing runs: `vitest-run-red-proof.txt`. Each section retains its
actual command/test failure. Faults discovered after first GREEN were repaired
against their own reproduced baseline; global key conversion order follows
native rhs-before-ToPropertyKey, not the discarded frozen unit assumption.
Native executable probes: `vitest-execargv-probe.cjs`,
`vitest-cli-admission-probe.mjs`, `vitest-cli-envelope-info-probe.cjs`.
Their captured outputs and independent DEC-2 records live alongside them.

To reproduce CLI probes: create `/tmp/rifty-vitest-native`, install exact
Vitest 4.1.11 with `overrides: {"vite":"8.0.16"}` using native npm,
then execute the committed scripts with Node 24.16.0. ExecArgv probe creates
its own temporary fixture tree; no installed dependency required.

## Acceptance commands

- Dev: `RIFTY_PLAYGROUND_PORT=5395 pnpm exec playwright test --project=chromium-heavy tests/e2e/vitest-run-in-browser.spec.ts`.
- Production: `RIFTY_PLAYGROUND_PORT=5396 pnpm exec playwright test --config playwright.prod.config.ts --project=chromium tests/e2e-prod/vitest-run-in-browser.spec.ts`.
- Delivery gate: `pnpm pr:check` (full lanes; no origin/main merge-base).
- Published bundles: `pnpm test:packed-consumer`.

The same real files execute on native Node and physical runtime Workers.
Vitest acceptance starts clean, installs real tarballs, honours TS config/include,
runs the failing tests on forks/threads, then fixes and reruns them.
Reporter counts/diff and terminal history exit codes discriminate silent exits.
Config-only jsdom/happy-dom and coverage reach actual dependencies and named
ceilings; CLI watch, VM pools, browser and coverage refuse named unclaimed modes.
Root info/canonical help prints once. No Vitest source edits or runner substitute.

## Build inventory

Compiler worker remains 10,022,694 bytes; shared chunk imports changed on rebuild.
Exact SHA-256 updated to `6a5f97ad641ce453a0bc2b9f8c9d0df4fc9a5ec75ef12974feb10a4f9e7be9ea`.
The 2 MB carrier ceiling and negative inventory tests remain unchanged.

## Current execution

- Production composed acceptance: 2 passed, 2.2 min; I1–I7 positive/negative scenarios.
- Config-only DOM/coverage dev acceptance: 1 passed, 1.6 min.
- Startup/admission unit selection: 41 passed; exact version ceilings covered.
- Lint/typecheck/build: passed. Full gate/packed results recorded before final review.

Goal completion requires independent Final+GREEN on the delivered revision.

## Independent repair pass

Review 1 on 1abb86ea found exit(null) inheritance regression and double-read
Buffer getters. Both real REDs captured; native Node oracle retained. Repair
unit selection: 9 passed; getter physical fork parity: 1 case matches Node.
Sibling sweep uses native Map contents and V8-ordinary Blob properties. Earlier
Blob host-clone assertion was a frozen structuredClone assumption, corrected
by executed Node v24.16.0 V8 oracle, not a widened browser claim.
First packed consumer failed Chromium cleanup deadline while competing with
full unit gate; isolated rerun required. First full gate's actual failures were
uncommitted compat drift, generator file-size, and missing integration import.
No behavior test expectation weakened.

I3 entry-origin sweep: CJS/ESM top-level Native Node v24.16.0 handlers print
entry-boom with origins uncaughtException/unhandledRejection, then after and exit0.
Real loader RED 2; GREEN entry/startup regression selection 26 tests.

Final sibling sweep: native Proxy is uncloneable; snapshot initially copied it
to an ordinary object (executed RED). Shared loader/Node bootstrap now record
guest native Proxy constructor/revocable outputs in one private WeakSet; native
clone rejects before traps. Unit reflection/rejection plus physical fork parity
GREEN. Proxy creation metadata is required; no extra lifetime/terminal owner.
CLI eval handler GREEN: real behavioral RED then 31-test entry/IPC selection;
physical CJS/ESM/eval acceptance 1 passed (27.0 s).

Isolated packed rerun reproduces Workspace owner exit timeout after close.
Root cause: private host IPC callback remains a counted public Node message
listener after owner lifetime settles. Real NodeProcess/kernel transport RED
refs1/no detach; GREEN detaches to refs0. Native guest IPC refs stay intact.
IPC slot-brand RED3→GREEN10: native V8 Date/Map/Set with changed prototypes;
constructor-source classification removed. SharedArrayBuffer V8 rejects; named
fork IPC ceiling added after reproduced RED.

Named process exit receiver: real Node v24.16.0 status7/EXIT7; actual loader
RED loses private receiver. Constructor exit/kill bindings retain names; GREEN13
builtin/lifecycle tests. Owner+IPC+controller selection GREEN21.

## Native IPC authority / final repairs (2026-10-02)

- Review2 @08c6c18b BLOCK saved in vitest-run-in-browser-review-2-final-green.json.
- Independent DEC-2 ipc_brand_decision: erased Promise has no non-mutating JS slot probe; native original-graph clone + weak Buffer side refs chosen (ADR0502 supersedes0501).
- `pnpm test:run packages/runtime-js/src/internal/advanced-ipc-values.test.ts packages/io packages/runtime-js/src/module-loader/symbol-global-write.test.ts tests/integration/node-program-exit-events.test.ts`: 31 files /756 tests GREEN.
- `pnpm test:parity child_process/advanced-ipc`: one physical Worker, same Node output; getter count1, opaque getter count0, Buffer/cycles/core slots GREEN.
- `pnpm test:packed-consumer` @08c6c18b: GREEN 1 test /229.58s; owner IPC finally detaches before drain.
- Build libs GREEN; exact compiler payload10,022,694 bytes, SHA ec34807999c518d3680ee751812f6cc21d595695725eea8872bed9c74f5590a5. Original byte/other asset ceilings unchanged; inventory gate GREEN.
- Lint2590files GREEN. Full gate + latest production recomposition pending.

### Final review follow-on repairs

- Native SAB Buffer snapshot RED (1→2 input mutation); encoder copies reachable shared Buffer bytes and rewrites both graph aliases/side refs; 25 IPC tests GREEN, physical advanced-fork parity GREEN.
- Native default timer exception/rejection RED: real DOM dispatch + real NodeProcess/drain/kernel; foreign defaults retained. Owned fatal records drain and suppresses browser peer-error race.
- Actual nonserve regression RED + pending-entry fatal RED: one existing drain tracks the existing entry outcome; nonserve waits for drain before natural exit. 55 focused lifecycle tests GREEN.
- Physical production fixtures now include fatal entry/timer/rejection + raw300/OS44; fatal oracle compares stdout/exit, independently checks diagnostic and no survivor. Stack paths intentionally unclaimed.

- Frozen repair build GREEN; compiler10,022,694 bytes unchanged, SHA111cc8295960af34a8a828a3b5c68e31c714cf20f0fc930ed76a624bbd2e56f8; exact pin refreshed, no ceiling widened. Full typecheck GREEN after both lifecycle producers adapted.

### Final finite IPC boundary

- e71 SAB-positive repaired decision superseded only by ADR0503 (independent DEC-2): Native per-value byte observation cannot be delivered by browser clone's shared graph. All reached shared-backed views, including Buffer, are named ceilings. Unrelated shared side refs excluded. Explicit gap, not Native rejection. Exact Vitest destination unchanged.
- 725 IPC/io tests GREEN; real-loader nonserve pending fatal repaired using same lifecycle owner, 57 lifecycle GREEN +full typecheck.
- Build GREEN, compiler10,022,694bytes SHA45a5d25968abf73eba24535e9086cdaca2af4fa2ee1460b36baedffde8fba7d1. No byte/other asset ceiling widened.
- Interrupted earlier full gates for newly required repairs; no full PASS claim. Latest full gate, production and packed proof pending.

Web-object oracle: `node docs/backlog/runtime-js/reference/vitest-web-clone-native-probe.mjs` → Nodev24.16.0, `v8 true { own: 7 } 1`, `clone true [] 0`; sibling output retained. Native ordinary own getter vs browser branded clone is the explicit WebObject ceiling.

### Full-gate Worker stdio repair

- Full gate @e9: 10,598 tests passed/18 skipped, one unhandled dest.end error; lint probe formatting also red. No failed assertions, test-file auto-rerun could not infer the error's source.
- Manual isolated child_process-worker-identity rerun reproduces10passed +1 unhandled; kernel Worker default pipes captured same-realm owner's write-only stdout/stderr, which differ from ambient process globals.
- Root owner uses end:false on both automatic parent pipes. Isolated10 +worker26 GREEN; revert10passed +1unhandled RED; restored10 GREEN. No test edited, no stream fake/stub introduced.
- Probe-only formatting fixed, lint GREEN. Product source changed only the two automatic pipe options; latest full gate still required.

- Worker stdio source build GREEN; exact compiler10,022,694bytes SHA0a43e58f88b33600fd2eabc8b2e4d3e3ab878c766046af7c6c01c9f0369530e4. Exact pin only; no ceiling change.

### Complete full gate

`pnpm pr:check --all` @497632a5: GREEN25/25. Unit run182.4s with no unhandled errors; full Native parity62.4s. Build/type/architecture/asset/artifact/doc lanes GREEN. Previous unhandled Worker stdio failure reproduced isolated once; repaired/revert-proved, all-source rerun clean.
BeforeExit outside-goal note split to draft process-before-exit-natural-drain; fresh RDY6PASS preserves the note when completed child is removed. Production Chromium and latest packed proof running sequentially next.

Production: `RIFTY_PLAYGROUND_PORT=5481 pnpm exec playwright test --config playwright.prod.config.ts tests/e2e-prod/vitest-run-in-browser.spec.ts --project chromium --workers=1` @497632a5: GREEN2/2,5.0min. Actual default fatal entry/timer/rejection +raw300/OS44 +physicalWorker contracts, then exact real Vitest TSconfig/tests bothpools fail→fix/npm/verbose/info/negative configuration. Latest packed follows sequentially.

### Native cloned-edge repair

Review found Error.cause data Buffer loses brand, nestedSAB bypasses0503. Native V8 actualoracle +RED; sweep also finds boxedString readonly indexes incorrectly assigned. One shared cloned-edge walker for encoder validation/decoder rebranding: Error.cause data, Map/Set, ordinary enumerable data; core primitives remain leaves. No original accessor replay/newtransport. Revert4RED. Physical fork Error.causeBufferalias +nestedSABreject GREEN.
An extra accessor Error.cause test incorrectly assumed getter1; executed Nodev24.16.0 serialize oracle returns gets0/hasOwnfalse/undefined. Corrected that reference premise explicitly; both Native and runtime skip this accessor. No implementation weakened to satisfy it.
Earlier fullgate/production/packed @497 allGREEN, but changed codec requires fresh composedproof.

- Native accessor oracle persisted: `node docs/backlog/runtime-js/reference/vitest-error-cause-accessor-native-probe.mjs` → v24.16.0 0 false undefined. Corrected test29 GREEN; valid guard revert3RED, restored29GREEN (prior4RED included that wrong extra expectation).
- Native-edge build GREEN; exact compiler10,022,694bytes SHA dfa9f3c5c9ea6784401beb915b2edaf43bfec36f28006e916887615363d37b2c, no widened ceiling. Physical advanced forkGREEN includes causeBufferalias +causeSABreject.
