# Worker fatal terminal provenance — observed repair, 2026-09-23

Required by startup clause 2: preload error then exit1, no entry. Native Node
24.16.0 baseline; existing browser fixtures failed before this repair on fresh
5439 (`/private/tmp/rifty-worker-fatal-preload-red.log`): both only emitted exit1.
Root trace: runNodeEntry rethrows the originating error after process lifecycle;
kernel runEntryLifecycleInternal discarded it after stderr and kept only code.
ADR-0460 records the same terminal-owner repair and runtime projection seam.

Additional native/Chromium controls before product edits:
`/private/tmp/rifty-worker-fatal-controls-red.log`: typed/non-Error throws RED;
explicit process.exit(1) and handled uncaughtException PASS. The typed guard
compares name/message/code, source stack and stdout before error before exit.
Existing five startup fixture assertions remain unchanged.

Native edge census (executable `/private/tmp/rifty-worker-fatal-native.mjs`,
output `-native.log`): undefined stays undefined; plain objects stay objects;
function/Proxy/uncloneable plain objects become inspect strings; a function
Error.code is omitted; a function Error.cause becomes an inspected string.
These are measured Node outcomes, not inferred serialization failures.

```sh
RIFTY_PLAYGROUND_PORT=5439 pnpm test:browser-unit tests/browser-unit/worker-thread-startup-options.spec.ts
node --import tsx tools/node-parity-runner/src/cli.ts worker_threads/startup
pnpm test:run packages/kernel/tests/worker-entry-drain.test.ts packages/kernel/tests/worker-entry-serve.test.ts packages/kernel/tests/worker-entry-setup.fault.test.ts packages/kernel/tests/spawn-worker-exit-attestation.fault.test.ts packages/kernel/tests/worker-terminal-drain.fault.test.ts packages/kernel/tests/spawn-worker-global-error.test.ts packages/runtime-js/src/builtins/worker_threads.test.ts
```

Fresh5439: 14/14 browser PASS (23.2s), including all native edge census values
above except the redundant uncloneable plain-object variant. Each case runs a
live native oracle first. `reuseExistingServer:false`; real Workers/native
preloads; no package patch. Log `/private/tmp/rifty-worker-fatal-green.log`.
One earlier 8/9 run lost its last page context during concurrent source updates;
the stable full run supersedes it.

Unit kernel expectations now assert the additive fatal envelope; existing
stderr/exit/cleanup expectations remain. New attestation fault controls reject
malformed fatal envelopes and guest-forged failure frames. A real native clone
failure in the projection hook remains a terminal DataCloneError, not a lost exit.
Initial unit run had seven old exact-frame expectations RED; their failed file
was rerun in isolation after asserting the new fatal metadata (7/7 PASS).

## Serialization-failure control and explicit boundary

Native function with a throwing name getter cannot be serialized or inspected:
`const f=function(){}; Object.defineProperty(f,'name',{get(){throw new Error('name-getter')}}); throw f;`
produces Error/ERR_WORKER_UNSERIALIZABLE_ERROR, then exit1. This is now a supported
native-parity guard; it proves an actual failure rather than inventing that code
from a missing hook or exit status.

Separate extra, uncertified custom-inspect probe found the existing inspector
ignores the hook. Driver decision: keep
`docs/backlog/runtime-js/util-surface-completions.md` as its owner; expose
`worker_threads.error.custom-inspect` as a named ceiling. No certified startup
clause or fixture changed. The original native custom-hook failure remains in
`/private/tmp/rifty-worker-fatal-native.mjs` and `-native.log`; the honest ceiling
has its own fixture/spec (`worker-thread-error-ceilings.spec.ts`). A guarded
revert of the ceiling produced real browser RED (silent inspected string);
source restored in finally. `/private/tmp/rifty-worker-fatal-custom-inspect-red.log`.
This explicit criterion change applies only to that added, unclaimed inspector
edge. Full util.inspect custom-hook support is not claimed by this repair.

## Error brand and metadata class repair

Additional same-source native/Chromium RED:
`/private/tmp/rifty-worker-fatal-shape-red.log`: foreign Error fields lost,
severed-prototype Error timed out, numeric code/requireStack/custom data lost.
The Worker projector now uses native Error.isError and the locally inspected
Node24 internal/error_serdes constructor-descriptor selection. Runtime RPC's
string-code diagnostic projection cannot meet this boundary and stays unchanged.
Kernel diagnostic formatting uses the same native brand; failed formatting is
inside the existing stderr guard and cannot discard the captured terminal.

An original cross-realm construction probe independently found earlier VM loss:
`/private/tmp/rifty-worker-error-before-projection.mts` + `.log` prints the Error
immediately after vm.runInNewContext, before throw/projection. Rifty already has
only stack/message/name, without guest-created code/requireStack/custom fields;
its stack already lacks the message. This is upstream of the new projector.
The projector guard therefore decorates the genuine foreign Error in the host
with those metadata fields and an explicit caller stack before throwing it;
it tests transporting available data and cross-realm type, not repairing VM's
pre-return loss. The original probe remains evidence for the existing VM gap.

## Final stable proof

Fresh5439 full startup + fatal boundary suite: **19/19 PASS, 29.5s**:

```sh
RIFTY_PLAYGROUND_PORT=5439 pnpm test:browser-unit tests/browser-unit/worker-thread-startup-options.spec.ts tests/browser-unit/worker-thread-error-ceilings.spec.ts
```

`/private/tmp/rifty-worker-fatal-final-browser.log`. This supersedes the
intermediate projector rewrite's two failures: function causes must be projected
before direct-function properties are omitted; Node's constructor selection
accepts descriptor values with a name, including QuickJS's constructor mirror.
Both failed cases were rerun in isolation first (2/2 PASS), then full suite.

Physical kernel Worker census uses the same 13 added supported fatal fixtures,
`expectedPhysicalWorkers:1` each; every stdout exactly matches native Node.
Executable `/private/tmp/rifty-worker-fatal-physical-census.mts`, output
`/private/tmp/rifty-worker-fatal-physical-census.log`. Existing three physical
startup parity cases also match (`/private/tmp/rifty-worker-fatal-parity.log`).

Projector descriptor rules were checked against the running Node24 source:
`process.binding('natives')['internal/error_serdes']`. The seven constructor
names and descriptor/cause ordering follow that actual source; constructor
identity from the host realm is not used as Error provenance.

A caller-decorated foreign Error probe before projection is separately retained:
`/private/tmp/rifty-worker-error-decorated-before-projection.mts` + `.log`.
It confirms the new projector receives the metadata; the original raw VM probe
above keeps the distinct pre-return loss visible.

Final gates: 137/137 kernel/Worker unit PASS; runtime-js and kernel typechecks
PASS; architecture, file-size ratchet, own-file Biome and diff-check PASS.
`/private/tmp/rifty-worker-fatal-{unit,types,kernel-types,arch,size}.log`.
No shared CHANGELOG or public compat edits by this producer; driver owns the
custom-inspect ❌ row, common startup checkpoint and independent Final+GREEN.
