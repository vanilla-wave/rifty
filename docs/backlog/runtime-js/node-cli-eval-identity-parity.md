---
area: runtime-js
status: ready
title: `node -e/-p` must use Node eval identity, not a temporary-file identity
created: 2026-07-15
why: The only Node CLI surface rejects `node -e/-p` outright, and the retired temp-file approximation it replaced had the wrong argv and module identity.
user_story: As a CLI author probing its invocation context under `node -e` or `node -p`, I want the same argv and module identity as Node 24, but today the terminal rejects the command.
sources: [M11, ADR-0155, ADR-0157, ADR-0337, ADR-0338, docs/backlog/runtime-js/reference/node-v24.16.0-cli-eval-probe.md, docs/backlog/runtime-js/reference/node-cli-eval-physical-carrier-probe.md]
code: [packages/kernel/src/worker-stdio-drain.ts, packages/kernel/src/process-manager.ts, packages/workbench/src/workers/node-entry-resolve.ts, packages/workbench/src/workers/workbench-project-runtime.ts, packages/workbench/src/workers/node-entry-bootstrap.ts, packages/runtime-js/src/builtins/node-entry-runtime-config.ts, packages/runtime-js/src/builtins/node-entry.ts, packages/runtime-js/src/module-loader/cjs.ts, tools/node-parity-runner/cases/process/node-eval-context.case.ts, tests/e2e/cli-report.spec.ts]
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

The item was demoted while those proofs gained one canonical invocation projection,
actor-tagged VFS observation, pre-projection path rejection, and strict exit
attribute decoding. The pre-demotion Acceptance and Parity remain verbatim
below.

## Fourth readiness re-cut

Contract+RED at `740c7705d` found two remaining `sibling-drift` holes without
changing Acceptance, Parity, or loud exclusions:

- attached short-option RED covered `-eSRC`/`-pSRC`, but not the `-peSRC` and
  `-epSRC` siblings through the native oracle, classifier, and Workbench owner;
- the named `--input-type=module` gap was pinned only for `-e`, leaving accepted
  print and long-option spellings free to fall into a generic option error or
  CommonJS eval.

The item was demoted while those exact sibling families gained native-oracle,
classifier, and no-child Workbench sweeps. The pre-demotion Acceptance and
Parity remain verbatim below.

## Fifth readiness re-cut

Contract+RED at `80f98be3e` found five remaining proof holes without changing
Acceptance, Parity, or loud exclusions:

- separated explicitly empty source tokens were not swept apart from missing
  source through the native oracle, classifier, Workbench owner, and physical
  parity carrier;
- a required child's parent was compared only by id and filename, not by strict
  identity with the detached eval record;
- Promise result RED did not preserve the realm Promise descriptor and
  constructor identity required by ADR-0337;
- the physical remote-VFS audit did not expose a child-local pre-bootstrap
  carrier/fallback;
- Workbench launch RED replaced the sibling kernel process manager with a fake
  handle instead of exercising the real admitted child boundary.

The item was demoted while those exact proofs gained cross-surface sweeps. The
pre-demotion Acceptance and Parity remain verbatim below.

## Sixth readiness re-cut

Contract+RED at `ac0f0a517` found four remaining proof holes without changing
Acceptance, Parity, or loud exclusions:

- immediate `--` consumption was not swept across every accepted spelling and
  every user-visible carrier;
- process adoption could drop separated empty eval source tokens without
  failing its nonempty `process.execArgv` RED;
- child-local VFS observation ran only in an injected carrier fault, not around
  the ordinary physical production bootstrap;
- the real-kernel Workbench boundary did not restore an originally absent
  kernel Worker URL.

The item was demoted while those exact sibling, aggregate, provenance, and
teardown proofs gained cross-boundary sweeps. The pre-demotion Acceptance and
Parity remain verbatim below.

## Seventh readiness re-cut

Contract+RED at `ab799709d` found one remaining `sibling-drift` cross-product
without changing Acceptance, Parity, or loud exclusions: missing, separated
empty, and nonempty source states were not crossed with `--` for every
separated eval/print spelling. Node v24.16.0 treats `--` in the source position
as the option terminator: mandatory `-e`/`--eval`/`-pe` report their usage
error, while optional `-p`/`--print`/`--print=ignored` evaluate `undefined`
with no script argument. A mandatory separated empty source still consumes a
following terminator; an optional separated empty token remains a script
argument, so a later `--` remains visible too.

The item was demoted while that exact source-state/terminator matrix gained the
same native, projection, classifier, real-admission, physical, and Chromium
carriers. The pre-demotion Acceptance and Parity remain verbatim below.

## Eighth readiness re-cut

Contract+RED at `b040667bd` found one remaining `provenance-lie` interval
without changing Acceptance, Parity, or loud exclusions: the child-local VFS
observer started after the physical Worker's process-adoption pre-entry hook,
so a source carrier created during `installNodeRuntime` could escape the
before/during/after audit.

The item was demoted while observation moved ahead of the pre-entry hook and an
injected child-local carrier crossed that exact interval. The existing
Workbench-owner and SAB-remote carrier faults plus unchanged physical-program
siblings remain the required sweep. The pre-demotion Acceptance and Parity
remain verbatim below.

## Ninth readiness re-cut

Contract+RED at `3a5dbf5ac` found four remaining false-GREENs without changing
Acceptance, Parity, or loud exclusions:

- only the literal `--print=ignored` exercised the arbitrary ignored RHS;
- equal owner and child-local fixtures could not prove remote-VFS selection;
- per-stream line aggregation reordered interleaved partial writes;
- corrupt bootstrap decoding happened before child-local VFS observation and
  waived the zero-effect audit.

The item was demoted while those sibling-drift, provenance, observable-order,
and corrupt-input proofs gained cross-surface sweeps. The pre-demotion Acceptance
and Parity remain verbatim below.

## Tenth readiness re-cut

Contract+RED at `4892e4f66` found four remaining false-GREENs without changing
Acceptance, Parity, or loud exclusions:

- the named ESM gap omitted the distinct-nonempty and empty `--print=` RHS
  classes;
- live ProcessManager snapshots could miss an attempted, failed, or already
  settled no-child allocation;
- callback-arrival ordering could not recover child write order after a legal
  inversion between independent stdout/stderr ports;
- the ninth readiness verdict was not the authoritative first Decisions line.

The item remains demoted while the local sibling/admission proofs and
cross-stream contract are re-judged. Every named ESM `--print=` RHS class now
crosses source and bare forms. Each no-child family installs the real recording
Worker boundary before execution and requires zero constructions as well as an
unchanged ProcessManager snapshot.

ADR-0338 supersedes ADR-0332 after a repo-wide mechanism sweep. The retained
process-wide admission assigns each stdout/stderr write a trusted contiguous
order; one kernel receiver reconstructs that order across the two independently
delivered ports before Workbench, parity, program, WASI, or worker-thread
consumers observe bytes. RED forces the later stderr delivery ahead of the
earlier stdout, requires no early suffix publication, then exact
`stdout → stderr → stdout` output and terminal drain. Raw-byte,
authenticated-witness, invalid-order, duplicate, stale, collision, gap,
per-stream-target, post-failure, and abandonment faults close the new boundary.
The pre-demotion Acceptance and Parity remain verbatim below.

## Eleventh readiness re-cut

The fresh readiness judge for the first ADR-0338 cut found three false-GREEN
classes without changing Acceptance, Parity, or loud exclusions:

- order validation omitted non-finite, unsafe, and ceiling values;
- byte/witness/target validation omitted wrong types, target drift, and
  post-target overrun;
- the envelope design changed the publicly exported raw stdout/stderr carrier
  without inventorying that observable boundary.

The item remains demoted while those classes are re-judged. ADR-0338 now
preserves raw `Uint8Array` messages on public `WorkerStdioPorts`,
`spawnKernelWorker`, and `WorkerProcessHandle.ports`. The existing
IPC/private-control lane carries one output-state-attested order witness; the
ordered receiver pairs that witness with each stream's FIFO bytes. RED retains
the legal cross-port inversion (`stderr` delivery before the earlier admitted
`stdout`) and adds exact public-byte, forged/malformed witness, non-finite/
unsafe/ceiling order, wrong-byte, target-drift/overrun, and torn witness-post
poisoning classes. Both trusted post capabilities are captured before the raw
ports are published, and the state/Atomics intrinsics are captured before guest
entry, so a guest intrinsic/instance/prototype interceptor cannot reveal the
secret or mutate the attested witness. The exported IPC decoder is itself RED
for the new private-control frame, and ProcessManager must consume that frame
without surfacing user IPC. Physical death after a byte post and failed witness
post discards the unprovable suffix and still settles once. The pre-demotion
Acceptance and Parity remain verbatim below.

## Twelfth readiness re-cut

The fresh readiness judge for the eleventh cut found two carrier false-GREENs
without changing Acceptance, Parity, or loud exclusions:

- the physical parity adapter still had only independent per-stream capture,
  with no RED forcing a legal cross-port inversion through its real Worker;
- ProcessManager's integration RED consumed the private order witness but did
  not assert that no user `'message'` event exposed it.

The item remains demoted while those two proofs are re-judged. The physical
parity RED now admits `stdout₀ → stderr₁ → stdout₂`, keeps control witnesses
FIFO, deliberately delivers the stderr bytes before stdout₀, and requires the
original ordered frame sequence before terminal settlement. The ProcessManager
RED observes user IPC across the same witness deliveries and requires no
message before or after drain. The pre-demotion Acceptance and Parity remain
verbatim below.

## Thirteenth readiness re-cut

The fresh readiness judge for the twelfth cut found one receiver false-GREEN
without changing Acceptance, Parity, or loud exclusions: every deterministic
success path delivered the authenticated witness before its raw chunk, while
the physical inversion did not order a raw callback against its witness.

The item remains demoted while the symmetric arrival proof is re-judged. Both
the package receiver and real ProcessManager route now deliver stderr raw bytes
before the matching FIFO witness and the final stdout raw bytes before their
witness. They require no early suffix publication, no user IPC disclosure,
then exact `stdout → stderr → stdout` output and terminal drain after the
matching witness arrives. The physical Worker inversion remains the
independent carrier proof. The pre-demotion Acceptance and Parity remain
verbatim below.

## Fourteenth readiness re-cut

The fresh readiness judge for the thirteenth cut found two receiver
false-GREENs without changing Acceptance, Parity, or loud exclusions:

- witness provenance rejected a missing or forged string secret but not a
  wrong-type value that coerced to the real secret;
- success paths held at most one unmatched raw chunk per stream, so a one-slot
  receiver could pass without the required per-stream FIFO.

The item remains demoted while those exact proofs are re-judged. Receiver RED
now rejects an object whose string coercion returns the authentic attestation.
Both the package receiver and real ProcessManager route enqueue two stdout raw
chunks plus one stderr raw chunk before any FIFO control witness, publish each
chunk only when its witness arrives, then drain exactly once after
`stdout₂`. The pre-demotion Acceptance and Parity remain verbatim below.

## Fifteenth readiness re-cut

The fault audit for the fourteenth cut found two remaining proof holes without
changing Acceptance, Parity, or loud exclusions:

- bind-time capability capture replaced each port instance method but not its
  prototype, so a writer that looked up the prototype later could expose the
  trusted byte/witness pair;
- normal cut tests did not require drain to remain pending when either the raw
  chunk or matching witness was still missing.

The item remains demoted while those exact proofs are re-judged. Primordial RED
now poisons both port instances and their shared prototype after bind and
requires zero interception. Receiver RED independently withholds the raw chunk
and the witness under an immutable nonzero cut, requiring no publication,
drain, or protocol failure. The impossible control-lane order gap remains a
loud protocol failure because authenticated witnesses share one FIFO port. The
pre-demotion Acceptance and Parity remain verbatim below.

## Sixteenth readiness re-cut

The fault audit for the fifteenth cut found one cut-time false-GREEN without
changing Acceptance, Parity, or loud exclusions: overrun RED covered
post-completion arrivals and already paired output, but not raw or witness
queues that already exceeded a newly installed immutable target.

The item remains demoted while that exact proof is re-judged. Receiver RED now
buffers two unmatched stdout raw chunks before `cut({ stdout: 1, stderr: 0 })`
and separately buffers two contiguous authenticated stdout witnesses before
the same cut. Each must produce one protocol failure with no publication or
drain. The pre-demotion Acceptance and Parity remain verbatim below.

## Seventeenth readiness re-cut

The fault audit for the sixteenth cut found one admission false-GREEN without
changing Acceptance, Parity, or loud exclusions: RED fabricated an active
writer and rejected re-entry, but did not prove that a real write owns the slot
across byte post, witness post, and counter commit.

The item remains demoted while that exact proof is re-judged. Writer RED now
starts `cutWorkerOutput` synchronously from the raw port's `postMessage`
callback. The cut must observe the real active slot, wait for witness and
counter commit, then resolve `{ stdout: 1, stderr: 0 }`; witness order zero must
exist and the slot must be released. The pre-demotion Acceptance and Parity
remain verbatim below.

## Eighteenth readiness re-cut

The fault audit for the seventeenth cut found one provenance false-GREEN
without changing Acceptance, Parity, or loud exclusions: witness
authentication assumes the guest-published process spec excludes the
kernel-owned output-state SAB, but no production-publication proof enforced
that boundary.

The item remains demoted while that exact proof is re-judged. The worker-entry
production proof now inspects the actual global process spec at the pre-entry
boundary and requires exact public process and stdio keys, no `outputState`,
and no top-level `SharedArrayBuffer` value. The trusted hook may receive the
full spawn spec; guest-visible global state may not. The pre-demotion
Acceptance and Parity remain verbatim below.

## Nineteenth readiness re-cut

The fault audit for the eighteenth cut found one nested provenance false-GREEN
without changing Acceptance, Parity, or loud exclusions: exact process and
stdio container keys did not prevent an allowed stdout/stderr writer value
from carrying the output-state SAB or attestation as an extra property.

The item remains demoted while that exact proof is re-judged. The production
publication proof now requires each output writer to expose exactly one own
`write` capability and recursively rejects any structurally reachable
output-state SAB or its attestation. The writer's closure remains opaque and
owns the state as intended; guest-visible object properties do not. The
pre-demotion Acceptance and Parity remain verbatim below.

## Twentieth readiness re-cut

The later readiness/fault audits found two false-GREENs without changing
Acceptance, Parity, or loud exclusions:

- the re-entrant cut observed active ownership during the raw post and after
  return, but not through witness post and counter commit;
- deserialization failure was injected on a raw output port but not on the IPC
  lane that carries authenticated order witnesses.

The item remains demoted while those exact proofs are re-judged. The writer
RED now observes active one and committed zero inside the witness callback,
then requires captured state stores in exact `counter=1 → active=0` order
before the re-entrant cut returns target one. ProcessManager RED injects
`messageerror` independently on stdout and private-control IPC, requiring one
finite exit-1/close, no process stdout or user IPC, one exact diagnostic stderr,
worker termination, and process record removal. The pre-demotion Acceptance
and Parity remain verbatim below.

## Twenty-first readiness re-cut

The fault audit for the twentieth cut found one raw-carrier false-GREEN without
changing Acceptance, Parity, or loud exclusions: byte-exact receiver assertions
did not prevent the trusted writer from transferring and detaching the caller's
`Uint8Array`.

The item remains demoted while that exact proof is re-judged. A real
`MessageChannel` RED now writes a retained non-zero-offset view, requires its
view and backing buffer to remain synchronously attached and byte-identical,
then requires the peer to receive the unchanged raw view plus its authenticated
order witness. The pre-demotion Acceptance and Parity remain verbatim below.

## Twenty-second readiness re-cut

The fresh readiness judge for the twenty-first cut found two remaining
Contract-sweep defects without changing Acceptance, Parity, or loud exclusions:

- the twentieth prose said `messageerror` produced no output while its exact
  existing loud-failure contract emits one diagnostic on stderr;
- runtime-js, WASI, kernel, and Chromium sibling carriers still invoked the
  output writer without its private-control port, permitting a witness-free
  fallback during implementation.

The item remains demoted while those exact corrections are re-judged. The
fault wording now distinguishes absent process stdout and user IPC from the one
exact diagnostic stderr. Every sibling carrier passes the same IPC/control
port to the writer and retains its observable output/terminal assertions, so a
faithful implementation can require one authenticated witness for every
committed raw frame without a compatibility overload. The pre-demotion
Acceptance and Parity remain verbatim below.

## Twenty-third readiness re-cut

The sibling sweep for the twenty-second cut found one contradictory
worker-entry setup assertion without changing Acceptance, Parity, or loud
exclusions: it prohibited every IPC post while the trusted setup diagnostic is
itself a committed stderr frame that requires an authenticated order witness.

The item remains demoted while that exact correction is re-judged. Setup-fault
RED now requires the diagnostic's exact stderr/order-zero witness. The
production publication proof also writes through the actual published stdout
and stderr capabilities before its injected hook failure, then requires exact
stdout-zero, stderr-one, and diagnostic-stderr-two witnesses on the supplied
IPC port. This closes both normal publication writers and the setup-failure
writer without a witness-free overload. The pre-demotion Acceptance and Parity
remain verbatim below.

## Twenty-fourth readiness re-cut

The completed carrier sweep for the twenty-third cut found two remaining
indirect sibling proofs without changing Acceptance, Parity, or loud
exclusions: the descendant-settlement carrier and real Chromium Worker suite
did not observe writer-produced witnesses on their parent IPC endpoints.

The item remains demoted while those exact proofs are re-judged. The recursive
owner RED now requires its admitted descendant-era stdout to carry exact
order-zero authentication with no user IPC disclosure. Real Chromium natural,
signal, global-error, and canceled-error paths likewise require exact
state-attested stdout/stderr witness sequences on the physical parent port and
no public `message` event; natural and global-error cover both published
writers and the separately bound diagnostic writer. The forced physical parity
inversion remains the custom-adapter proof. The pre-demotion Acceptance and
Parity remain verbatim below.

## Twenty-fifth readiness re-cut

The carrier audit for the twenty-fourth cut found one over-constrained physical
expectation without changing Acceptance, Parity, or loud exclusions: a timer
throw escapes the Worker and its diagnostic stderr is emitted locally by the
parent ProcessManager, so it cannot carry a child output-order witness.

The item was demoted until that exact correction was re-judged. Real Chromium
global-error RED now requires only the child's admitted stdout/order-zero
witness while retaining the parent diagnostic stderr and terminal proof. The
worker-entry setup-failure RED remains the exact child diagnostic-writer proof.
The pre-demotion Acceptance and Parity remain verbatim below.

## Twenty-sixth readiness re-cut

The Contract+RED sibling sweep for the twenty-fifth cut found one legacy
three-argument writer binding in the real parity Worker adapter without
changing Acceptance, Parity, or loud exclusions.

The item is demoted while that exact carrier correction is re-judged. The
physical adapter now binds stdout and stderr with the supplied IPC/private
control port before process publication. Its forced cross-port inversion RED
requires the exact state-attested stdout-zero, stderr-one, stdout-two witness
sequence on the parent endpoint and proves that none becomes public user IPC.
The package, recursive-child, runtime, WASI, worker-thread, setup-fault, and
Chromium sibling proofs remain unchanged. The pre-demotion Acceptance and
Parity remain verbatim below.

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
| `observable-order` × physical stdout/stderr delivery | Independent output ports deliver a later admitted write first | ADR-0338 receiver buffers the suffix and reconstructs authenticated child write order before any consumer or terminal event. |
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

ready-verdict: 2026-07-30 — Node v24.16.0 artifacts and same-invocation parity/CI-active Chromium REDs settle supported grammar, atomic v3 launch, detached `[eval]` identity/cache/resolution, print/lifecycle/errors, VFS provenance, isolation, and the acceptance carrier; ADR-0337 settles the sole launch and loader seam; ADR-0338 plus package, recursive-child, runtime-js, WASI, worker-thread, setup-fault, real-Chromium, and repaired real parity-Worker REDs settle the minimal authenticated cross-port ordering mechanism, including four-argument stdout/stderr binding to `spec.stdio.ipc`, exact state-attested stdout-zero/stderr-one/stdout-two parent witnesses under forced inversion, and zero public IPC; loud exclusions, public/raw/process-publication boundaries, stale/overlap, removable-machinery, and unchanged pre-demotion Acceptance/Parity are closed.

- ADR-0337 owns the irreversible atomic node-entry v3 shape and the one
  loader-owned unwrapped-script mechanism. There is no v2 compatibility reader.
- ADR-0338 owns one package-internal ordered-output receiver over the retained
  process-wide writer admission. Workbench, parity, program, WASI, and
  worker-thread paths consume the same ordered kernel Readables; none owns a
  callback-arrival reorder fallback. Public stdout/stderr ports retain exact
  byte messages; one authenticated private-control witness supplies order.
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

IRREVERSIBLE node-entry protocol/context choice recorded by ADR-0337 and
cross-port output-order mechanism recorded by ADR-0338. Parser, loader,
inspector, and acceptance carriers remain replaceable behind those exact
behaviors.

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
