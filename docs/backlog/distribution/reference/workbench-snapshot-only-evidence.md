# Snapshot-only preparation evidence

BASE: I8 accepted source39ea3f0ca84e081c528f0d9acf9ddb873d4a9c7c.
No I3 implementation yet. Host-policy authority: goal I3, original answers in
embedder-gaps-evidence.md; ADR-0398 preserves I8/ADR-0394 application ownership.
Independent source research: workbench-snapshot-only-pickup.md.

## npm-client baseline RED

Independent scratch carrier35 cases:30 semantic RED/5 existing GREEN; Node24.16.0,
Vitest2.1.9. Actual RegistryClient/MemoryVfs/installer/VfsTarballCache and real
ms2.0.0 tarball; only external fetch mocked. Strict scratch typecheck/Biome PASS.
Commands, paths and full explanation: /tmp/rifty-316-i3-red-npm/EVIDENCE.md;
raw /tmp/rifty-316-i3-red-npm/red-final.log and red-final.json.

Existing four-argument install already supports exact lock/cache, metadata/cache
and empty graph with absent registry. One/three-argument overloads reject options
without registry; required metadata/tarball misses dereference undefined; absent
registry with Eddy reaches real prefetch/pinned GET/POST or silently accepts its
configuration with a covered lock. No missing-import/compile-only REDs.

The test's documented temporary LocalOptions→InstallOptions cast makes registry
actually absent under the old required public type. It supplies no dummy client;
remove this preparation bridge when the real public field becomes optional.

Copied unchanged into the main test environment and rerun:35 cases,
30 semantic RED/5 GREEN. /tmp/rifty-316-i3-npm-red.json and npm-red.log.

## Workbench and shell baseline RED

Five staged owner/options/wire/terminal files copied with SHA256 comparison
from /tmp/rifty-316-i3-red-workbench/evidence.json. Main environment rerun:
36 cases,25 semantic RED/11 GREEN; /tmp/rifty-316-i3-workbench-red.json and log.
Workbench typecheck PASS: /tmp/rifty-316-i3-prep-workbench-typecheck.log.

Real owner/catalog/VFS/stamps/Shell and public producer; only external fetch
controlled. Required503/hash/template/artifact/JSON/over-limit/replay failures
incorrectly yield deferred install. Cold core fallback changes retained live
bytes and hides policy behind generic install failure. The actual owner wire
serializer/inspector/deserializer carries reason assertions. Terminal tests
exercise cache-backed local replay, required metadata misses, prefer-online and
recursive/prefix npm invocation without a registry capability.

Existing GREEN: actual snapshot/warm trust, registry-enabled deferred fallback,
edited named Save/restart ignoring an unused bad snapshot, explicit bad apply
byte preservation, absent saved trust refusal and malformed option controls.

Separate real shell carrier7 cases:2 semantic RED/5 existing GREEN. Absent
registry plus Eddy invokes preset/prefetch/learned-pin callbacks and egress
before refusal; configured registry install and actual nearest/explicit-prefix,
test alias and pre/main/post lifecycle outputs pass. Raw:
/tmp/rifty-316-npm-shell-no-registry-red.log and json.

## Public packed baseline

Actual tarball-only consumer reaches strict TypeScript and rejects the new
public configuration: snapshot-only-proof.ts:49 TS2353, mode absent from the
published packageAcquisition type. /tmp/rifty-316-i3-packed-red.log,68.69s.
This is public surface RED; the behavioral owner/npm carriers supply separate
semantic RED. Planned browser journey additionally proves missing-snapshot404
across the real public owner, original-producer Vite build/dev/HMR, required npm
denial and persistent I8 saved-state composition under hostile registry counters.

## Required Vite producer observation

Packed fixture preparation now serves original npm tarballs for the same pinned
Vite closure, replacing repacked installed snapshot files (including the old
esbuild facade). Exact name/version, recorded npm SRI, byte length and metadata
dist identity are asserted. Original files/provenance live in
tests/integration/fixtures/registry/rollup-companions/.
Existing positive-control assertions remain. This strengthens the registry
boundary; no producer/input-policy check is weakened. Independent PR-4 review
must inspect this changed fixture authority.

Disposable current public producer + real npm package-lock-only input failed
EBROKENLOCK for @rollup/wasm-node. Initial fixture-only probe:
/tmp/rifty-316-i3-producer-probe-2.log. Independent original upstream probes
reproduced with rollup4.63.1 and vite7.3.6; esbuild0.28.0 control passed.
Raw: /tmp/rifty-316-i3-independent-probe/results.json and output.log.
The old companion lockfile rule and caller-pin protection must be reconciled
through explicit ADR/RED before this required composed proof can pass; no
producer check is relaxed during preparation. Investigation remains in I3.

## Companion preparation and final checking criteria

Two new suites16 cases:7 semantic RED/9 existing GREEN,0 timeouts/unhandled,
14.18s. Original npm locks and17 original tarballs (8,323,806B), SHA512 checked
on load. /tmp/rifty-316-i3-independent-probe/new-tests-red-final.log;
full preparation corrections and command: red-evidence.md in that directory.

RED: root/nested declared companion loses policy source; corruption never reaches
required acquisition; Eddy mirror suppresses its resolver; producer root fails;
new ordinary companion-child paths must reach strict producer refusal. The
nested-refusal forecast was subsequently corrected against actual retained
placement, below.
Controls retain actual fresh-install companion lock and exact source identities,
reject ordinary missing children/corrupt bytes, and execute extracted real WASM
Rollup under Node with bundle result42. Node control0.59s:
/tmp/rifty-316-i3-independent-probe/node-control-green.log.

Native npm {rollup,wasm-node} co-demand is not a supported success control:
existing ordinary bins collide. Original locks remain provenance, no upstream
bin/metadata stripping. Retained success uses actual existing fresh installation.
The initial fresh-install forecast for nested @types placement was incorrect;
producer still refuses actual unpinned ordinary paths. No new placement mechanism
or all-nested success promise is introduced. Current ordinary/direct-bin tests remain; old
pre-shim missing-companion rejection is explicitly superseded by ADR-0399 and
must be judged independently before any old test expectation changes.

After main import, npm-client typecheck exposed a TS rootDir leak from the test's
external local-registry.ts import. Replaced only harness loading with original
ms JSON/tgz data, preserving both published versions and the real RegistryClient.
All35 named outcomes unchanged:30RED/5GREEN. Typecheck/Biome PASS;
/tmp/rifty-316-i3-npm-typecheck.log and red-fixed.json/log.

## Preparation acceptance and corrected oracles

Preparation contains no product source. Fresh snapshot_only_contract_review
independently reproduced94 cases64RED/30GREEN,36 original controls GREEN,
checked all17 original archives and reran native Vite build. Contract+RED42/42
PASS at98773a29f; implementation then began.

The same reviewer found two missed oracle mistakes during implementation and
verified their exact corrections against executed old-source probes:
five expected registry/Eddy URLs must preserve the input's absent trailing slash;
missing replay files produce the existing tarball-cache/lockfile-closure reason.
No production diagnostic or URL behavior was changed to match the bad tests.
Only those six lines changed in preparation-only307655de2; corrected same review
re-bound there. /tmp/rifty-316-i3-url-oracle-verification.md,
/tmp/rifty-316-i3-url-oracle-probe.log,
/tmp/rifty-316-i3-replay-reason-probe.log.

## Implementation verification in progress

Public/owner acquisition uses one closed union decoder. The physical strict
owner supplies no registry/Eddy capability; the package actor derives immutable
automatic-fallback policy from the actual registry capability. Saved trust,
initial receipt and apply/rollback owners remain I8. Required failures keep
their concrete message across the wire; refused restore/promotion cannot
schedule destructive preparation or publish ready.

The real installer recognizes all overloads without registry, keeps existing
local metadata/tarball caches and throws only on a required network miss.
Contradictory Eddy is rejected at install normalization and before shell
callbacks/preparation. Preparation casts removed; no denying RegistryClient.

Executed: new Workbench36/36, registry/shell42/42, existing
open/wire/legacy338/338 and package/I8 saved/apply123/123 GREEN. Parent mixed
old/new installer/lockfile/shell regression274/274 GREEN. Raw:
/tmp/rifty-316-i3-workbench-green.json,
/tmp/rifty-316-i3-workbench-implementation-evidence.json,
/tmp/rifty-316-i3-registry-capability-green.json,
/tmp/rifty-316-i3-registry-regression.json.

One cohesive private acquisition decoder adds source inventory150→151;
complete exact closure assertion remains. Old private wire fixtures gain
explicit mode:registry; old public omitted-mode inputs remain. The first-open
browser Worker fixture follows the same private normalized shape. Package actor
and shell source ratchets shrink; no ceiling raised.

Full gate, original-tarball packed browser proof and independent Final remain;
baseline packed type rejection alone is not execution proof.

## Nested placement oracle correction

The public producer canonicalizes manifest dependency order and retains caller
lock paths. Fresh installation, sorted or unsorted, is not its placement oracle.
Independent current producer output retained12 ordinary path/version/resolved/
integrity triples; only the existing esbuild recipe and two declared companions
added paths. Real Node executes both acquired Rollups with result42. Old source987
replays this emitted complete lock without metadata; the separate actually
unpinned ordinary-child case still rejects. Reviewer's evidence:
/tmp/rifty-316-i3-nested-review/{probe.log,report.json,replay-control.log}.

PR-4 approves replacing only the incorrect nested-refusal expectation with this
exact success/path/identity/Node oracle; no producer permission, placement rule
or contract is relaxed. Source record uses the existing install-result WeakMap
and companion-only demand set, intersected with actual declared parent/path/
version facts. Ordinary co-demand cannot become a companion exemption.

Final preparation binding4053ad0a adds the approved nested oracle and an erased
TypeScript read of npm's optional marker (internal LockfileEntry omits it).
Same reviewer verified exact committed changes and old-producer semantic RED;
no product files entered those preparation commits.

## Companion GREEN and guard checks

New companion/producer17/17 GREEN16.27s; existing shim/lockfile/Eddy/bin/recipe/
producer128/128 GREEN41.38s. One corrupt-case5s contention timeout after the
earlier enormous failed-archive dump passed isolated52ms, timeout unchanged.
Final corrected suite has no such dump. Logs and source hashes:
/tmp/rifty-316-companion-implementation.md.

Reverting the shared companion frontier produces2 semantic RED (root+Eddy);
reverting producer permission produces1 RED. Both files restored in finally,
before/after SHA256 equal; restored smoke3/3 GREEN. Artifact:
/tmp/rifty-316-companion-revert-check.json. npm-client/Workbench types and Biome
pass. Old pre-shim rejection changed only under ADR-0399's reviewed supersession;
ordinary missing-child, identity, optional and bin guards remain.

## Packed public GREEN

PASS80.50s: /tmp/rifty-316-i3-packed-green-3.log. Original npm Vite producer,
copied runtime assets, no registry URL, missing-snapshot reason across owner,
local script, actual npm build/dev, real iframe/native HMR, explicit npm failures
and persistent saved/application proof all execute. Server-side registry and
browser registry/Eddy/unused-asset observations remain zero. Earlier configured
registry Vite/HMR/sqlite and I1/I2/I8 journeys remain positive controls.

Harness corrections preserve the promised behavior:

- Vite preview's missing asset used SPA200 fallback, correctly yielding
  snapshot-id-mismatch rather than404. A deliberate404 response was added only
  for the fault fixture URL; the original public reason assertion remains.
  /tmp/rifty-316-i3-packed-green-1.log.
- Parent's additional full npm-install success assumption was false: snapshot
  replay cache carries substitution acquisitions, not every ordinary tarball.
  Independent real15-package producer has1 cached esbuild-wasm tarball and
  correctly refuses a later required cache miss without egress. PR-4 evidence:
  /tmp/rifty-316-i3-public-replay-oracle-verification.md. The added call now runs
  after dev/HMR and awaited run.close(), asserting the exact missing-tarball
  refusal. Lower warm-cache success and new-package negative remain. No archive,
  cache, installer or producer policy was changed for this harness assumption.
  /tmp/rifty-316-i3-packed-green-2.log is the captured failure.

Architecture, directory ownership, reduced file-size ceilings, current snapshot
artifacts and original exact compiler/WASM retirement fingerprints pass. The
hand-maintained compat row was committed before the drift gate's index comparison.

Final `pnpm pr:check`25/25 PASS: test:run184.0s, parity62.0s;
/tmp/rifty-316-i3-pr-check-final.log. First full run passed24 lanes and found
only three formatting errors in test/harness files; formatted those, lint passed,
then repeated the full gate. No product or assertion change after packed80.50s.
