# Node child startup options — 2026-09-23

Authority: vitest-run-in-browser goal I4/I5/I6; required generic startup behavior.
Node v24.16.0; installed exact Vitest 4.1.11 / Vite 8.0.16. No Vitest source
patch. Current protocol is rifty.node-entry/v5, not the older draft's v3.

## Exact native forcing path

Installed source cli-api.CnMVyzaz.js: resolveOptions lines 3800–3803 contributes
experimental-import-meta-resolve + --require suppress-warnings.cjs;
resolveConditions lines 3814–3830 supplies node/development; task lines
3727–3735 append configured execArgv; ThreadsPoolWorker.start lines 3229–3235
passes the resulting vector to native Worker.

Executed from the retained exact installation:

```sh
node --require /private/tmp/rifty-vitest-worker-argv-census.cjs node_modules/vitest/vitest.mjs run --pool=threads
```

The preload records arguments through a transparent native Worker constructor
Proxy, then syncBuiltinESMExports updates the builtin ESM binding. No worker
option or package source is changed. Result: 1 file / 2 tests passed; actual
entry node_modules/vitest/dist/workers/threads.js; actual argv:

```json
["--experimental-import-meta-resolve","--require","<project>/node_modules/vitest/suppress-warnings.cjs","--conditions","node","--conditions","development"]
```

The installation root is
/var/folders/db/686y1tsx0cj84rn_2jmrf9680000gn/T/rifty-vitest-oracle-EHSQJy.
Browser diagnostic /private/tmp/rifty-vitest-with-messageport.log reports
worker_threads.Worker.execArgv at the same ThreadsPoolWorker.start call.

## Generic native semantic proof

Fixtures: tests/browser-unit/fixtures/worker-startup-options-cases.ts; oracle:
worker-startup-options-oracle.ts. Executed:

```sh
node --import tsx /private/tmp/rifty-worker-startup-native.mts
```

All five native parents exit 0, stderr empty:

| case | observed |
|---|---|
| effective-options | exact vector survives caller-array clear; preloads [a,b], shared cache count 2; require/static/dynamic all development; parentURL changes directory; builtin node:fs unchanged |
| explicit [] control | argv/preloads []; cache count 0; all three loaders select node; parentURL ignored; parent's [parent] marker unchanged |
| trusted-recursive-inheritance | middle clears public execArgv; omitted grandchild options retain original vector and every effect; explicit [] resets every effect |
| preload-missing | error MODULE_NOT_FOUND then exit 1; entry marker absent |
| preload-throwing | error preload-failure then exit 1; entry marker absent |
| malformed-options | missing --conditions / --require each synchronously Error ERR_WORKER_INVALID_EXEC_ARGV; subsequent [] Worker reports control |

The public-array mutation oracle extends the existing inherited-exec-argv
probe; it does not promise source-bearing eval flags. A disposable exploratory
[42] argv probe was accepted by native Node; non-string option coercion is
outside this typed supported-family contract, not asserted invalid.

## Current owner boundaries

- worker_threads.ts rejects nonempty overrides before allocating a thread.
- node-entry-runtime-config.ts v5 worker-thread exact allowed fields have no
  execArgv. Process.ts initializes public argv only for eval launches.
- resolver-profile.ts activeConditions is fixed node/import-or-require/
  module-sync/default; esm-job-evaluation.ts metaResolve takes one argument.
- node-entry-bootstrap owns process/loader readiness and entry execution;
  existing Worker lifecycle owns preload errors and terminal settlement.
- child_process.fork has no execArgv projection; an independent same-source
  native/physical/browser probe below confirms silent loss. The shared startup
  owner must cover it, with distinct producer inheritance rules.

## RED execution

```sh
node --import tsx tools/node-parity-runner/src/cli.ts worker_threads/startup-
RIFTY_PLAYGROUND_PORT=5421 pnpm test:browser-unit tests/browser-unit/worker-thread-startup-options.spec.ts
```

Physical adapter: final 4 RED; every startup case constructs 0 Workers instead
of required 1/2/3 because nonempty argv is rejected. The malformed-options row
runs through Chromium instead: the Node adapter's subsequent [] control hit
its existing 10-second drain limit, unrelated to the contract's operand error.
That extra physical wrapper was removed; no product test expectation changed.
Full physical log: /private/tmp/rifty-worker-startup-parity-red.log.

Chromium final 5 RED: effective-options / recursive-inheritance / both preload
failures stop at worker_threads.Worker.execArgv. Malformed-options observes
[NotImplementedError,null] twice instead of [Error,ERR_WORKER_INVALID_EXEC_ARGV];
its following [] Worker reports control and exits 0. Log:
/private/tmp/rifty-worker-startup-browser-red.log.

Carrier corrections before these results: Workbench already exposes scratch as
the process root, so use node main.cjs, not cd /scratch. Condition fixtures use
native package #imports with the same conditional-target resolver, avoiding a
manually seeded node_modules tree requiring an install receipt and unrelated
package self-reference support. Relative resolution targets exist on both
sides; nonexistent-file import.meta.resolve behavior is not used as a carrier.

## Executed fork sibling — required, same unit

Independent lifecycle agent executed the exact installed Vitest fork census
(/private/tmp/rifty-native-fork-flags.mjs and .log): the same option tokens,
absolute suppress-warnings.cjs, serialization advanced and stdio pipe; one file,
two tests pass. The program path is not an arbitrary capability expansion.

```sh
node --import tsx tools/node-parity-runner/src/cli.ts child_process/startup-options
RIFTY_PLAYGROUND_PORT=5426 pnpm test:browser-unit tests/browser-unit/fork-startup-options.spec.ts
```

Durable source: tests/browser-unit/fixtures/fork-startup-options-case.ts.
Final strengthened fixture launches four physical children. Native v24.16.0
returns exit 0 for every row: exact-family, caller-snapshot and public-default
retain exact argv/preload 1/require+import development/parentURL true; explicit
[] returns argv[]/preload 0/node/false even under a nonempty public vector.
Both physical parity and fresh Chromium 5426 are RED on all three positive
rows: rifty drops every effect despite exit 0. Explicit [] control matches.
Native artifact: /private/tmp/rifty-fork-startup-options-native.log. RED logs:
/private/tmp/rifty-fork-startup-options-parity-red.log and
/private/tmp/rifty-fork-startup-options-browser-red.log.

Producer distinction: Worker omitted override inherits trusted engine launch;
fork's native JS producer defaults from current public process.execArgv. Caller
arrays are snapshotted at construction. The strengthened durable fork case
executed that distinction and both post-construction mutations, as well as
the exact-family/[] pair.

A separate native malformed-fork probe confirms why Worker errors must not be
copied to fork: execArgv ['--require'] consumes modulePath as its preload
operand; ['--conditions'] consumes it as a condition and leaves no entry.
The returned ChildProcess is not a synchronous ERR_WORKER_INVALID_EXEC_ARGV.
The latter disposable child was explicitly terminated. Malformed fork vectors
remain a named ceiling outside this supported well-formed family, not a claim
that both surfaces share error timing.

## Preparation status

Draft contract and proposed ADR-0456 only; no product implementation.
Fresh independent Contract+RED remains required. Broader inherited eval flags
and CLI preload contexts retain their prior drafts/ceilings. Root owns goal map,
ledger, final review and eventual real Vitest rerun.

## Implementation proof and carrier correction

Direct v6 schema RED: node-entry-startup-schema.test.ts, 5/5 failures before
migration (both variants require own immutable argv; retired v5 is not read).
After migration: that suite plus existing config/IPC/Worker tests 99/99 GREEN.
Producer/pre-entry migration suites: 254/254 GREEN. Runtime-js/Workbench tsc and
architecture gate pass. Custom conditions now include argument-first followed
by declaration-first, while package declaration order is reversed: native
require/static/dynamic all select declaration-first. This prevents a whitelist
or argv-priority implementation from passing the condition proof.

Fresh Chromium 5436: normal Worker effects, recursive inheritance/reset,
malformed syntax and four fork variants GREEN; two preload failures expose the
existing missing Worker error-before-exit route, assigned to its lifecycle
owner. Root's unchanged full Vitest probe on 5438: 10 commands GREEN.

PR-4 carrier correction, authorized by goal driver: native physical adapter
hardcoded drainHook:null and only finalized thrown entries, retaining a stale
serve:true Worker assumption. It now calls real kernel await-drain/finalize
owners. Effective-options physical parity is GREEN. Its nested-host adapter
still cannot recursively construct isolated Workers (executed count 1 instead
of 3; no child native constructor/isolation wiring). The redundant physical
recursive wrapper is removed; its exact fixture/assertions remain unchanged in
the live native oracle plus real Chromium Worker suite, already GREEN. No
recursive emulation/counter machinery added; no product behavior test weakened.
Logs: /private/tmp/rifty-startup-schema-red.log,
/private/tmp/rifty-startup-custom-conditions-native.log,
/private/tmp/rifty-startup-worker-physical-green.log,
/private/tmp/rifty-startup-recursive-adapter-limit.log.


## Final focused GREEN

- Runtime-js and Workbench typechecks; architecture and file-size gates pass.
- Exact v6/IPC/Worker unit set: 99/99. Producer/pre-entry migration: 254/254.
- Node entry/eval/require loader regression set: 35/35.
- Canonical process binding regression: the new fork default initially read an
  embedder's native argv instead of the logical process builtin. Existing fork
  tests reproduced in isolation; one shared currentNodeProcess selector now
  owns both consumers. Unchanged fork conformance/identity set: 33/33 GREEN.
- Native next-option operand probes reject --conditions --unknown and --require
  --conditions development. New differential tests: 2 RED then GREEN; supported
  syntax is not accidentally accepted as a filename/condition.
- Physical Worker startup cases: 3/3 match Node, including originating preload
  errors after the lifecycle owner repair. Fork's four semantic variants match.
- Full parity-harness/schema/operand set: 55/55 GREEN, including retired-protocol
  faults and the unchanged two HTTP preview cases. Those two initially exposed
  the separate MessagePort shim dropping a native return used by BroadcastChannel;
  root reproduced and repaired that owner. No preview assertion changed.
- Lifecycle agent fresh Chromium 5439: first 14 startup/fatal cases GREEN;
  broader fatal-projection edge handling remains that owner's report.

Commands/logs: /private/tmp/rifty-startup-fork-regression-green.log,
/private/tmp/rifty-startup-operand-red.log,
/private/tmp/rifty-startup-focused-green.log,
/private/tmp/rifty-startup-worker-all-green.log,
/private/tmp/rifty-startup-final-fork-parity.log,
/private/tmp/rifty-startup-final-harness-green.log.
