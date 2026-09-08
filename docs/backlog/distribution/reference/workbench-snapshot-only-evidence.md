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
new ordinary companion-child/nested paths must reach strict producer refusal.
Controls retain actual fresh-install companion lock and exact source identities,
reject ordinary missing children/corrupt bytes, and execute extracted real WASM
Rollup under Node with bundle result42. Node control0.59s:
/tmp/rifty-316-i3-independent-probe/node-control-green.log.

Native npm {rollup,wasm-node} co-demand is not a supported success control:
existing ordinary bins collide. Original locks remain provenance, no upstream
bin/metadata stripping. Retained success uses actual existing fresh installation.
Nested original graph introduces ordinary @types placement; producer continues
refusing unpinned new ordinary paths. No new placement mechanism or all-nested
success promise is introduced. Current ordinary/direct-bin tests remain; old
pre-shim missing-companion rejection is explicitly superseded by ADR-0399 and
must be judged independently before any old test expectation changes.

After main import, npm-client typecheck exposed a TS rootDir leak from the test's
external local-registry.ts import. Replaced only harness loading with original
ms JSON/tgz data, preserving both published versions and the real RegistryClient.
All35 named outcomes unchanged:30RED/5GREEN. Typecheck/Biome PASS;
/tmp/rifty-316-i3-npm-typecheck.log and red-fixed.json/log.

## Preparation status

No product source changed. Public surface and semantic RED are recorded;
Workbench/npm-client typecheck, targeted Biome, refs/backlog pass. Clean
independent Contract+RED remains before implementation. Packed browser GREEN
must additionally run after implementation; baseline packed type rejection
alone is not execution proof.

