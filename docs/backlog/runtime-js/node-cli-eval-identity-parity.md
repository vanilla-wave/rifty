---
area: runtime-js
status: draft
title: `node -e/-p` must use Node eval identity, not a temporary-file identity
created: 2026-07-15
why: The only Node CLI surface rejects `node -e/-p` outright, and the retired temp-file approximation it replaced had the wrong argv and module identity.
user_story: As a CLI author probing its invocation context under `node -e` or `node -p`, I want the same argv and module identity as Node 24, but today the terminal rejects the command.
sources: [M11, ADR-0155, ADR-0157, ADR-0337, docs/backlog/runtime-js/reference/node-v24.16.0-cli-eval-probe.md, docs/backlog/runtime-js/reference/node-cli-eval-physical-carrier-probe.md]
code: [packages/workbench/src/workers/node-entry-resolve.ts, packages/workbench/src/workers/workbench-project-runtime.ts, packages/workbench/src/workers/node-entry-bootstrap.ts, packages/runtime-js/src/builtins/node-entry-runtime-config.ts, packages/runtime-js/src/builtins/node-entry.ts, packages/runtime-js/src/module-loader/cjs.ts, tools/node-parity-runner/cases/process/node-eval-context.case.ts, tests/e2e/cli-report.spec.ts]
---

## Context

Workbench is the only surface that parses `node` argv
(`node-entry-resolve.ts:45` `classifyNodeInvocation`); its `eval` kind throws
`NotImplementedError('workbench.node.eval-context')`
(`workbench-project-runtime.ts:335`). Honest, but it blocks the first-screen
Node CLI scenario. The legacy Playground path that ran a transient
`.rifty-eval-*.cjs` through `node <file>` is gone from production code — it
preserved loader execution but gave eval a file entry, added that path to
`process.argv`, registered the wrong module identity, and could leave workspace
bytes; `workbench-project-runtime.test.ts:939` pins that no such file appears.
Reviving it is out of scope, not an alternative.

## Second readiness re-cut

Contract+RED at `fb857235e` rejected snapshot-only VFS provenance, an
ambient-version oracle, and eval sync-API drift into physical program siblings.
The re-cut at `8c419caca` closed those three faults but exposed five uncovered
boundaries: exact source-bearing `process.execArgv`, post-return cache absence,
the package-internal loader seam, carrier-vs-guest VFS mutation provenance, and
preview-scope consumption.

The observable Acceptance and Parity cases below remain unchanged. The current
re-cut replaces every lossy or misclassified RED:

- `node-eval-context.case.ts` and `run-in-node.test.ts` compare complete
  source-bearing `process.execArgv` tokens against the pinned v24.16.0 oracle.
- `module-loader/node-eval.test.ts` owns the package-internal runner RED, checks
  two distinct detached records after return, and proves one child cache is
  reused without either eval record entering it. `public-surface.test.ts` pins
  both public namespaces closed.
- The append-only parity VFS audit subtracts each declared guest mutation once;
  an injected carrier write/delete runs below guest source through the real
  decoded launch, SAB sync client, and remote VFS before production bootstrap.
- A physical concurrent eval RED waits for each child's exact listening-control
  scope, fetches each server through the scoped preview bridge, then signals and
  awaits both supervised children. This proves lifecycle consumption and
  cross-child isolation, not payload inequality alone.
- Both probes reject non-eval cases, while the existing physical program
  `env-semantics`, `stdio-plan-drain-order`, `public-ipc-json`, and
  `missing-cwd-entry` siblings remain unchanged and GREEN.

A fresh readiness judge independently verified that this evidence closes the
re-refinement without weakening the preserved contract; the item is `ready`.

## Third readiness re-cut

Contract+RED at `4cf878752` found four carrier false-GREENs, without changing
Acceptance or Parity:

- native `nodeArgv` and the Rifty launch projection were independently declared;
- equal path/arguments/bytes could not distinguish carrier from guest VFS work;
- error projection could discard a carrier path before the `[eval]` frame;
- a missing terminal-history exit attribute coerced to status 0.

The item is demoted while those proofs gain one canonical invocation projection,
actor-tagged VFS observation, pre-projection path rejection, and strict exit
attribute decoding. The pre-demotion Acceptance and Parity remain verbatim
below.

## Refinement evidence

The item was demoted at `0fa204fd3` after the exact Node oracle contradicted two
frozen assumptions. `--print=<source>` is not an inline-source form: Node treats
the RHS as ignored option data and obtains source from the next argument.
Node's `-p` also uses console single-argument formatting, so a string is
unquoted. The reproducible command/output/version artifact now settles both
forks and the deferred print mechanism; ADR-0337 settles the required atomic v3
launch carrier. The original Acceptance and Parity sections remain verbatim at
the end for the readiness diff. The corrected contract preserves every
original observable: spellings are tested with Node's real meanings, and
string, undefined, object/array, bigint, Promise, circular, error, exit, cache,
and isolation coverage all remain.

## User scenario

A new user opens the Node CLI Starter and runs
`node -p "require('./package.json').name + ':' + process.argv.length" demo`,
then a package's documented `node -e` probe. The command must resolve relative
modules from the project, print the same value as Node v24.16.0, expose eval
identity rather than a generated workspace file, and return the real exit code.

## Acceptance

1. Workbench parses Node 24's supported CommonJS eval spellings:
   `-e <source>`, `--eval <source>`, `--eval=<source>`, `-p [source]`,
   `--print [source]`, `--print=<ignored> [source]`, and `-pe <source>`.
   Missing source for plain `-p`/`--print` evaluates `undefined`; bare `-pe`
   is an eval usage error. Missing `-e`, empty `--eval=`, `-ep`, other attached
   short-option source, and unsupported options retain Node-shaped exit-9
   failures. An immediate `--` after source is consumed; remaining tokens are
   script arguments.
2. Those forms build one exact `rifty.node-entry/v3` eval launch in the
   existing admitted foreground Node Worker. The launch carries source, print
   mode, and original `process.execArgv`; the process spec carries
   `[process.execPath, ...scriptArgs]`. It reuses process adoption, remote VFS,
   CJS resolution, PTY/private control, output cut/drain, signals, preview
   ownership, and exit settlement. Source never travels through argv, env,
   workspace bytes, a URL module, or a second evaluator.
3. Runtime-js executes one loader-owned unwrapped CommonJS eval script with the
   synthetic identity and cwd resolver below. The detached module is never
   registered in `require.cache`; required children still link to it as their
   parent. No public `ModuleLoader` API or second process lifecycle is added.
4. `-e` prints only user output. `-p` captures the script completion value and
   prints it exactly once through Node-compatible console single-argument
   formatting at natural exit after asynchronous work drains. Explicit
   `process.exit` suppresses result output. String, undefined, object/array,
   bigint, fulfilled/pending/rejected Promise, circular reference, and
   post-timer mutation cases match Node v24.16.0.
5. Differential cases run the same source, cwd, spelling, and script arguments
   in Node v24.16.0 and through the Workbench terminal's physical supervised
   child, comparing normalized stdout, stderr user prelude/frame, ordered
   stream frames, and exit status. Sequential and simultaneous children prove
   cwd/argv/module/output/preview isolation. A VFS observer proves that no eval
   path exists before, during, or after.
6. The CI-active acceptance carriers are
   `tools/node-parity-runner/cases/process/node-eval-context.case.ts`,
   Workbench launch/validator/fault tests, and CI-active Chromium
   `tests/e2e/cli-report.spec.ts`. That browser test runs the host Node oracle
   and the Node CLI Starter terminal for the same invocation, using the
   physical carrier proven by
   `node-cli-eval-physical-carrier-probe.md`. Only all-GREEN differential and
   Chromium proof may flip CommonJS CLI eval to compat ✅; source grep, a fake
   child, or an opt-in lane cannot close it.

## Reference contract

- Oracle: Node v24.16.0, CommonJS eval mode.
- Reproducible oracle:
  `docs/backlog/runtime-js/reference/node-v24.16.0-cli-eval-probe.md`.
- Node mechanism: detached `[eval]` module + unwrapped current-context script
  completion + `beforeExit` print with `exit` fallback.
- Rifty carrier: ADR-0337 node-entry v3 eval launch, runtime-js loader-owned
  eval seam, existing supervised-child lifecycle.
- Physical differential reachability:
  `docs/backlog/runtime-js/reference/node-cli-eval-physical-carrier-probe.md`.

## Parity cases

1. Grammar/identity: every accepted spelling preserves the exact original
   `process.execArgv`. With script args `alpha`, `two words`,
   `process.argv === [process.execPath, 'alpha', 'two words']`; no entry path is
   present and `process.argv0` retains rifty's existing Node-process identity.
   `--print=ignored <source>` proves the RHS is not source; missing print source
   produces `undefined`.
2. Script/module identity: `this === globalThis`, `typeof arguments ===
   'undefined'`, `__filename === '[eval]'`, `__dirname === '.'`,
   `module.filename === resolve(launchCwd, '[eval]')`, `module.id === '[eval]'`,
   `module.path === '.'`, `module.parent === undefined`, and `module.loaded ===
   false` while source runs. `require.main` and `process.mainModule` are
   undefined; top-level `var` is global and top-level `return` is a syntax
   error.
3. Loader/cache: relative require, `require.resolve`, and package lookup remain
   anchored to launch cwd even after `process.chdir()`. `module.paths` matches
   Node's cwd ancestor order. The eval record is absent from `require.cache`
   before/during/after; a required child's `parent` is that same detached
   record.
4. Result order/format: raw string, `undefined`, object/array, bigint,
   `Promise { 42 }`, `Promise { <pending> }`, rejected Promise prefix, and
   `<ref *1> ... [Circular *1]` match normalized Node output. A timer that logs
   and mutates the completion object is observed before its final result
   print. A timer-settled Promise prints fulfilled.
5. Lifecycle/errors: normal completion and `process.exitCode=N` drain then
   exit; immediate `process.exit(N)` exits N without result output. Throw,
   syntax failure, and unhandled rejection exit 1. Error stdout/stderr ordering,
   source prelude/caret, and first user frame use `[eval]:<line>:<column>`; no
   generated or project-absolute temporary filename leaks.
6. Isolation: two sequential and two simultaneous physical eval children use
   distinct cwd fixtures and preview scopes. Each returns only its own
   argv/module/resolver marker/stdout/stderr/exit, cannot enter a sibling's
   cache, and settles exactly once.

## Fault matrix

| Axis × operation | Injected fault | Honest outcome |
|---|---|---|
| `frozen-assumption` × CLI spelling/format | Treat `--print=` RHS as source or quote a top-level string | Node differential fails the exact `execArgv`, source, or stdout row. |
| `sibling-drift` × launch surfaces | Workbench, parity adapter, or recursive builder invents another eval carrier | Exact v3 launch/physical-child contract rejects; all consumers use the one typed variant. |
| `observable-order` × result/exit | Print before timer drain, twice, or after explicit exit | Ordered stdout and exit tests fail; one natural-exit owner prints or forced exit suppresses. |
| `poisoned-cache` × synthetic record | Register/reuse `[eval]` or rebase its resolver after `chdir()` | Cache, parent, launch-cwd resolution, and sequential-child differentials fail. |
| `concurrent-same-key` × same entry identity | Two `[eval]` children share cwd/module/output/preview state | Simultaneous distinct-fixture physical children expose any cross-talk. |
| `provenance-lie` × source transport | Materialize source as a workspace/data/temp module | Before/during/after VFS observer and stack/cache identity fail; compat remains ❌. |
| `corrupt-input` × v3 bootstrap | Wrong protocol, missing/wrong-type/extra eval field, non-string `execArgv`, or program-only field | Builder rejects before Worker allocation; child decoder rejects before source/VFS effects; no v2 or program fallback. |

## Out of scope

- ESM eval via `--input-type=module` is a separate runtime context. Until it has
  its own parity contract, `node --input-type=module -e/-p` throws
  `NotImplementedError('workbench.node.eval-module-context')` and remains compat
  ❌; it never falls back to CommonJS.
- Preload/import flags `--require`/`-r` and `--import` are not added here. They
  retain explicit unsupported-option behavior and compat ❌; this item does not
  silently ignore them.
- The bare `node` REPL remains the ADR-0155 loud gap; eval support must not
  masquerade as an interactive REPL.
- Full Node CLI option parsing, TypeScript eval, and broad `util.inspect`
  options/colors/depth parity remain separate. This item implements only the
  accepted spellings and result shapes enumerated above; other flags fail
  loudly.
- Node 24's TypeScript-stripping eval context is separate. Source/options that
  require it throw
  `NotImplementedError('runtime-js.node-eval-typescript-context')` and remain
  explicit compat ❌; they never run as partial JavaScript or a file module.
- Node-internal stack frames and the `Node.js vX` trailer are not synthesized;
  the exact `[eval]` user frame is in scope.

## Decisions

ready-verdict: 2026-07-30 — ADR-0337 and ADR-0155/0157/0267/0325/0326/0332/0334 settle scope, overlap, atomic v3 transport, loader ownership, process/stdio/preview boundaries, and the natural-exit print owner; the retained Node v24.16.0 oracle plus verbatim pre-demotion contract settle corrected CLI grammar, argv/execArgv, eval/module/resolver/cache identity, unwrapped completion, formatting, error/exit order, and sequential/concurrent isolation without weakening Acceptance or Parity; the retained Chromium physical-carrier probe and existing parity, exact-own validator, supervised-child, PTY/private-control, VFS, output-drain, process-adoption, preview, and e2e carriers settle physical reachability and every Parity/Fault boundary; existing CJS record/resolver, console formatter, and drain/exit authorities deliver Acceptance without a temporary carrier, second evaluator/lifecycle/cache, or new coordination mechanism.

- ADR-0337 owns the irreversible atomic node-entry v3 shape and the one
  loader-owned unwrapped-script mechanism. There is no v2 compatibility reader.
- Supported CLI grammar is a pure Workbench classifier that retains original
  eval option tokens for `execArgv`; unsupported Node options remain loud.
- Eval's module record reuses the CJS record/resolver authority but stays
  detached from ModuleRegistry. The public loader surface does not widen.
- Print reuses console one-argument formatting and the existing process drain/
  exit owner. It does not stringify, await the returned Promise, or create a
  second event-loop ledger.
- `runtime-js/require-cache-module-record-surface` remains compat ❌; this item
  proves only that eval's detached record is absent. Broad inspector options,
  process identity outside eval, ESM eval, preload/import, and REPL items remain
  separate and are not implied green.

## Reversibility

IRREVERSIBLE node-entry protocol/context choice recorded by ADR-0337. Parser,
loader, inspector, and acceptance carriers remain replaceable behind that exact
behavior.

## Pre-demotion contract (verbatim)

The following sections are copied unchanged from the ready contract demoted at
`0fa204fd3`.

### Acceptance

- Workbench dispatches `-e`/`--eval` and `-p`/`--print` to one eval-specific
  launch kind in the existing supervised Node child. The launch reuses the
  runtime-js CJS loader, process seeding, stdout/stderr, drain, signal, and exit
  machinery used by `node <file>`; it does not write a file or add a second
  evaluator.
- Differential cases run the same source, cwd, and script arguments against
  Node v24.16.0 and the Workbench terminal. No generated eval path exists
  before, during, or after the run; no `[eval]` module is inserted into
  `require.cache`.
- `tools/node-parity-runner/cases/process/node-eval-context.case.ts` pins the
  reference observables below. Workbench contract tests prove the launch payload
  and no-write boundary; a real Chromium first-15-minute e2e runs `node -e` and
  `node -p` from the Node CLI Starter.
- Only after all differential and Chromium proofs are GREEN may the
  `node -e/-p` compat row become ✅. A source grep or a fake child cannot close
  the item.

### Parity cases

1. `-e`, `--eval`, `--eval=<source>`, `-p`, `--print`, and
   `--print=<source>` preserve source and every argument after it. `--` is
   consumed as the option terminator. For script args `alpha`, `two words`,
   `process.argv === [process.execPath, 'alpha', 'two words']`; no entry path is
   present and `process.argv0` retains the existing Node-process identity.
2. In CommonJS eval, `__filename === '[eval]'`, `__dirname === '.'`,
   `module.filename === resolve(cwd, '[eval]')`, `module.id === '[eval]'`,
   `module.parent === undefined`, `module.loaded === false` while source runs,
   and `require.main === undefined`.
3. `require('./relative.cjs')`, `require.resolve('./relative.cjs')`, and
   package lookup resolve from cwd. `module.paths` has the same cwd-anchored
   order as Node. Eval's synthetic module is absent from `require.cache`.
4. `-e` prints only user output. `-p` prints one Node `util.inspect` result
   after side effects: string, `undefined`, object/array, bigint, fulfilled
   Promise, and circular-reference cases match Node v24.16.0 formatting.
5. Normal completion, explicit `process.exit(N)`, rejected/throwing source,
   and syntax failure follow the existing supervised-child drain and exit
   contract. Error prelude and user frame name `[eval]:<line>:<column>`; no
   generated eval file (`.rifty-eval-*` or any other) and no project-absolute
   temporary filename leaks.
6. Two sequential and two concurrent eval children keep cwd, argv, module,
   stdout/stderr, exit, and preview scopes isolated; one child cannot become
   another's `require.main` or cache entry.
