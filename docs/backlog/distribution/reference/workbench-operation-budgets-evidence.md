# I7 effective budgets — preparation evidence

Accepted goal scenario7/I7 and recorded embedder decisions own scope. Private
Tracker code/raw interview transcript unavailable; no substitute consent claim.
BASE accepted I5:7f967cb546f51101397b99948575f18577680248, rechart e9d034f8b.
No I7 production implementation during preparation. ADR-0410 records the
independently reviewed range decision and existing-owner propagation.

## Observable authority / boundary inventory

B ownerStartupTimeoutMs: existing outer owner-ready30s and OPFS proof step30s;
ready includes mount/preload/catalog after lease/SW admission. Independent
physical-exit observation30s is cleanup, not startup. F
projectFileCommitTimeoutMs: post-applied coordinator phases60s and hidden
owner-VFS ACK/recovery35s; no new pre-ACK timer. T playgroundRequestTimeoutMs:
non-TS tools60s after document-save admission. Catalog stays uniform S
ownerOperationSilenceTimeoutMs60s/progress-only; P previewProbeTimeoutMs remains
independent. Shared native active-IO report30s derives from explicit B/F/T/S max;
all omitted stays30s, P excluded. Capture once per paired OPFS instance; same
scheduler/ledger/path fences. No global setter, retry or additional timer owner.

Native Chromium148/Node24.16 prove overflow can fire immediately; original
positive-finite helper admits it. Independent DEC-2:
workbench-operation-budgets-range-decision.md. All five public fields now select
finite0<value<=2147483647, upward integer normalization; worker input already
normalized. This does not change guest Node timers. ADR-0360 partial correction
keeps uniform progress-only S/fatality/recovery and kernel/child exclusions.

File owner publishes state BEFORE ACK: owner-vfs-authority publishSnapshot and
workbench-project-vfs publish then terminal share one ordered channel. A delayed
snapshot also delays ACK; post-ACK snapshot reordering is physically excluded.
Existing generic reflection tests retain that coordinator contract; reachable
40s/70s durability cases test both shorter siblings. No claim that preparation
isolated the60s mutant: baseline first fails35s; isolate coordinator forwarding
after implementation for the70s case.

Fault sweep: owned value projection (normalizer→boot→storage), page/Worker
slow peer/death (one FIFO physical port), native OPFS active write/report/close
and capacity/path fences. Duplicate/lost-then-replayed/reordered live port
frames are excluded. Corrupt caller/wire values remain reachable. Snapshot
asset header/body/decompression10s applies to later project acquisition, not B/F/
T; no accepted asset-stall override/global open wall-clock promise. TS/PTY/guest
execution and snapshot caps unchanged.

## Committed unit carriers

Command, Node24.16.0/Vitest2.1.9:

```sh
pnpm exec vitest run --project unit packages/workbench/src/workbench/workbench-operation-budget-options.contract.test.ts packages/workbench/src/workbench/workbench-owner-startup-budget.contract.test.ts packages/workbench/src/workbench/workbench-file-budget.contract.test.ts packages/workbench/src/workbench/workbench-playground-budget.contract.test.ts packages/workbench/src/workbench/workbench-budget-wire.contract.test.ts --maxWorkers=1 --minWorkers=1 --reporter=verbose
```

Integrated run:56cases =40semanticRED/16GREEN,2.33s;
`/tmp/rifty-316-i7-integrated-unit-red.log`. Original independent preparation
runs/replays agree; no import/setup/typecheck failure counted as product RED.

| carrier | actual graph / obligation | preparation |
|---|---|---|
| options + startup | real public normalizer/createOpenWorkbench before effects and actual owner-port admission; external capability/physical readiness/clock only |23cases20RED/3GREEN; all5 fields/range/ceil/freeze, B short/long/default and independent cleanup |
| file | public F→real browser owner/content/client/coordinator→real project VFS/package mutation/authority/MemoryFS; held suffixes of real FIFO frames |8cases3RED/5GREEN; F90 at40/70s, F15 applied rejection; omitted35s,70s pre-ACK, one-send, death before/after ACK |
| tools/catalog | public T/S→real browser-owner/runWorkbenchOwner/catalog/Git/VFS/session tools; external task-queued Worker IPC/clock only |15cases9RED/6GREEN; SCM/archive/durability/close long+short, late actual archive mutation, default60s, save barrier, death, catalog S |
| wire/max | real normalizer and existing exact boot inspector |10cases8RED/2GREEN; each explicit B/F/T/S, max/ceil/P exclusion, normalized B/IO/P wire, default omissions |

Existing FILE baseline37/37GREEN; existing S silence controls9PASS/19skipped
cover all operation kinds, progress-only rearm, unrelated-traffic exclusion and
fatality. Detailed preparation logs: `/tmp/rifty-316-i7-file-budget-{red-final,
baseline}.log`; `/tmp/rifty-316-i7-tools-contract-tests/{red-final,
red-isolated-rerun,silence-baseline}.log`; ingress root/typechecked copies in
`/tmp/rifty-316-i7-ingress-contract-tests/`.

## Actual native OPFS carrier

```sh
RIFTY_PLAYGROUND_PORT=5491 pnpm exec playwright test --config playwright.browser-unit.config.ts tests/browser-unit/operation-storage-budget.spec.ts
```

Integrated Chromium148:8cases6semanticRED/2defaultGREEN,8.7s;
`/tmp/rifty-316-i7-integrated-native-red-final.log`. First integrated attempt
failed only new bare io import resolution; corrected to public src/index entry,
then all8 reached their real boundaries. No production/import-map change.

Real native handles, actual paired OpfsFsSync/drain scheduler and default
storage installer. Public B passes normalizer→browser boot serialization→native
MessageChannel→actual decoder/runWorkbenchOwner inside a DedicatedWorker.
Minimal process-boundary adapter replaces pre-entry, never storage/catalog;
physical owner-ready/death separately covered by existing adapter controls.
Only native close/getFile/removeEntry delivery and clock are delayed.

Explicit90s must survive30s then report90s; explicit10s reports10s. Omitted30s
control already passes.16native lanes retain their writes/zero closes through
report timeout; same-path and capacity dependents stay blocked. Late release:
18writes/closes,17paths, clean ledger, exact second-0/capacity bytes, no resend.
Caller mutating options after installation cannot change the captured bound.
B90 close/read/cleanup each must yield actual OPFS/durable after40s release;
baseline selects memory at30s. Omitted B30 read fallback already passes. Separate
proof90+newIO90 case tests the default installer, not an invented private B API.

Original isolated runner also6RED/2GREEN. Its first Vite config accidentally
regenerated App SW; corrected configFile:false replay preserved exact hash/status.
That side effect and independently accepted canonical I5 artifact disposition
remain in service-worker/reference/workbench-preview-prefix-app-proof.md.
Native/spec and wire typechecks passed. Initial spec indexed-record optionality
errors were fixed with an explicit missing-observation assertion before replay.

## Mandatory packed composition

Both maintained scoped fixture/helper changed: public B90/F95/T100/S105 seconds,
P30, actual catalog/startup, versioned source write+durability, real SCM refresh,
archive exact decoded bytes, then existing Vite build/dev/HMR/reload/outside-host/
zero-egress proof. Root/default/strict and earlier I1/I2/I3/I4/I6/I8 journeys
remain. No new machine-speed SLA or deep fault imitation in this fixture.

Installed current public types: TS2353 on missing ownerStartupTimeoutMs,
`/tmp/rifty-316-i7-packed-prep/type-red.log`. This is interface absence, NOT the
runtime-effective RED carrier; source/native56+8 cases carry that discrimination.
Scratch emitted JS against retained current copied assets executes all new
operations GREEN, with exact archive bytes/durable OPFS/real Vite build and no
registry/Eddy requests/external attempts/pageerrors. New B/F/T ignored by baseline;
this control is not effective-budget GREEN. `runtime-control-public-path.log`,
`runtime-control.json` in that directory.

Preparation corrected SCM expectation to existing public absolute
/src/message.ts (real inspector enforces it); archive paths remain relative.
Initial setup errors (Playwright resolution, macOS realpath, producer files
copied after build) were scratch plumbing, not product failures. No source patch
made that baseline control pass. Final composed packed proof remains required.

Integrated Workbench source/test typecheck and native fixture/spec typecheck
both pass. Native standalone config explicitly points typeRoots at this
checkout's Node declarations; its initial /tmp config lacked ambient Node
types and was corrected without product changes. Logs:
`/tmp/rifty-316-i7-integrated-workbench-types.log`,
`/tmp/rifty-316-i7-integrated-native-types-final.log`.
