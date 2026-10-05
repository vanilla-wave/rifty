# Agent npm install — I9 evidence

BASE8f5516e070d7fd918309f0a9de5379c51351b462 (accepted SDK lifecycle).
Native Node24.16.0/npm11.17.0, genuine vendored ms2.0.0/2.1.3, HTTP registry
shared by native npm and rifty. No mocked installer/VFS/Worker/Pi.

- Browser RED12: ten native save cases, real Pi shell and missing registry;
  actual old script-only dispatcher returns NotImplementedError text/exit1.
  `/tmp/rifty-pr357-install-red1.log`.
- Fault RED2: install never reaches registry, readonly command has no install
  policy route. `/tmp/rifty-pr357-install-fault-red.log`.
- Shared COI RED8/control2: actual Shell/PackageAcquisitionAuthority/MemoryVfs/
  installer succeeds but saves raw/latest instead of resolved ranges, ignores
  save-exact and duplicates moved sections. Native tilde/no-args controls pass.
  `/tmp/rifty-pr357-install-shared-red.log`.
- Native probes and expanded section matrix: `/tmp/rifty-pr357-native-install*
  .{mjs,json}`, `/tmp/rifty-pr357-coi-install-probe.{mts,json}`. Live committed
  tests regenerate native expected dependency state, not self-derived goldens.

Mechanism sweep: no-coi-toolchain-worker.installManifest already owns demotion,
checked flush/promotion and activation. runNoCoiProjectCommand already owns the
same busy slot and Stop signal. InstallMirrorVfs actual writes resolve current
syncMirror (projectContext); raw FS is only a clean durable-byte skip predicate.
The callback must reuse these owners, not install recursively through RPC.

Other baseline observations from broader native probes: whole-lock descriptive
metadata (root name/license), missing-manifest initialization differ in the
existing installer/COI glue. I9's carrier is an opened project with package.json;
full npm CLI/lock serialization is not claimed by this slice. Contract review
must check this boundary against the accepted goal rather than infer exact-byte
conformance from “change as npm would”. No source repair has started yet.

Native persistence carrier separately RED1 (missing persistence kind because
script-only install never runs), `/tmp/rifty-pr357-install-persistence-red.log`.

Contract+RED accepted8121fb14e,11/11 coverage, no blockers. Broader metadata
observations captured in `../../npm-client/npm-project-metadata.md`; real same-HTTP
probe confirms them, public compat row marks ❌. No I9 dependency-state exemption.


IMPLEMENT proofs:
- Shared native save10/10; a real held-HTTP/concurrent-editor regression was
  RED (new post-install save overwrote the edit), then GREEN11/11. Save now checks
  staged bytes and attests intended serialized bytes, never a later readback.
  Failure rollback only restores bytes this operation owned.
- Legacy success doubles returned empty lock graphs. No product fallback added.
  Successful save/stamp cases now run actual installer/MemoryVfs/vendored inputs;
  real debug replaces fictitious lodash+ms pair, scoped @types/estree tarball
  replaces fake scope package. A cached progress line uses a real warm cache.
  FIFO/demotion/slug-at-start/guard assertions retained. Three fake pin assertions
  moved into two stronger actual-Eddy cases (merged request key × absent/prior
  CAS baseline). All157 integration tests GREEN. Suite moved to tests/integration
  because it now imports real cross-package registry fixtures, not package-local
  unit doubles. No compiler rootDir exemption.
- Browser I9 all15 GREEN (within combined baseline run), incl. registryConnected
  true/false+readonly, actual network count, cooperative Stop/busy and quota/retry.
  Quota expectation corrected from pending-only to absent: existing
  install-stamp-authority.prepareTreeMutation removes the marker before writes;
  Acceptance6 forbids trust, not absence. Actual retry succeeds.
Logs: `/tmp/rifty-pr357-install-{editor-red,shared-green2,integration-final,browser-green2}.log`.

## Required SDK regression discovered during baseline verification

The unchanged bounded-cause runBin scenario hung after accepted SDK235586e27
reused serializeRuntimeError in Workbench: reading a genuine gap's own cause
getter threw while constructing the error reply. Root owner worker-fs-rpc.ts;
corrupt-input/provenance-lie at owned in-process error projection. Native Worker
loss/duplication/reorder physically excluded; failure born before postMessage.
Sibling sweep: Worker FS and terminal errors already use this serializer; SDK
project and Workbench owner serializers do not project cause. Command declared-gap
selection is independently bounded and preserves its existing behavior.

Isolated real Chromium RED at30s; unit3 accessor RED+1 native-description control.
Fix: data descriptors only, native DOMException intrinsics; metadata lookup bounded
against proxy prototype cycles (additional real JS RED). Original error receipt
survives an unreadable optional cause. Unit5/5; actual Chromium bounded-cause and
both occupied deadlines3/3 GREEN. Accessor/bound removal mutants both RED,
restored source5/5. No new promise/contract; existing baseline per RDY-8.
Logs `/tmp/rifty-pr357-cause-{red,browser-red,prototype-red,browser-green,accessor-mutant,bound-mutant,restored-green}.log`.
The combined baseline was interrupted at its reproduced hang; full baseline rerun
follows the repair, no passing claim from the interrupted run.

Final baseline no-coi-sandbox-build-loop21/21 GREEN (1.5min), including live COI/no-COI build parity; `/tmp/rifty-pr357-install-baseline-final.log`. SDK/workbench/agent typechecks and lint pass; source cause controls restored5/5.

## Final-review correction and complete baseline

Independent Final blocked b3e3b4547: native `ms@~2` saves ^2.1.3; initial
heuristic saved ~2.1.3. Class sweep against npm11.17's Arborist/semver7.8.4
also reproduced ~2.0, bounded, union and minor-wildcard save mismatches.
Shared live differential RED5/control12 → GREEN17. ADR-0488 replaces operator
heuristics with npm's actual subset rule; same sixteen cases run in Chromium.
Logs `/tmp/rifty-pr357-install-{review-ranges,ranges-red,ranges-green}.log`.

Initial full gate: copied TypeScript-worker digest changed from shared-chunk
references (size unchanged10022664); unit23 failures/7 timeouts under load38.
Gate was stopped during automatic isolation to apply review repair. Completed
manual isolated rerun:7 files/15 failures;4 files passed (including IPC resize,
shadow installer, snapshot and physical-Worker parity controls). No clean-gate
claim from that interrupted run. `/tmp/rifty-pr357-install-isolated-red.log`.

Baseline criterion corrections (PR-4):
- Prompt golden removes only the superseded host-only dependency sentence.
- Prefix and durable catalog expectations use native saved caret ranges;
  root selection, failure/reload and byte-preservation assertions retained.
- Extraction map follows the existing npm suite's exact new integration path;
  production closure gains the extracted helper, semver is declared explicitly.
- Affected owner explicit-install/FIFO cases use actual kleur/ms; unchanged
  legacy doubles elsewhere remain outside this acquisition proof. The .vite-temp
  lifecycle carrier now snapshots genuine ms, installs genuine semver with its
  real bin, preserves an extraneous marker and churned .vite-temp files through
  install/run/install/A→B→A. No manufactured lock result or fake bin closes it.

Save/stamp/FIFO and emitted-pin negative suite221/221, lint and Workbench
typecheck GREEN. Packed toolchain surface PASS15 first-party+73 external,
including actual compiler loading. Old-source esbuild overlay at SDK8f5516e07
reproduced exact prior TypeScript-worker SHA00545…; current ffeebf… differs
only in shared/dynamic import filenames and side-effect import order, same
10022664 bytes. `/tmp/rifty-pr357-install-compiler-pin-diff.log`.

Source-dev Chromium exposed missing explicit CJS prebundles for new semver
subpaths (module has no default export); packed build already passed. Add all
three imports to both Playground and no-COI optimizeDeps lists. Initial browser
command accidentally included Firefox/WebKit; interrupted, no GREEN claim.
Required tier reruns Chromium explicitly.

Final committed becdaddfb: Chromium21/21; full pr:check27/27, no isolated reruns
(test:run197.2s, parity119.5s). Independent Final+GREEN PASS19/19; source save
reprobe independently GREEN. Logs `/tmp/rifty-pr357-install-ranges-chromium.log`
and `/tmp/rifty-pr357-install-pr-check-final.log`. I9 closed; I8 remains.
