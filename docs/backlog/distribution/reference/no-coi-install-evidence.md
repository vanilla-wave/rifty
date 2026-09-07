# Deferred install evidence

Baseline: accepted I3 @ 7a431a09a5b1c69b09a11b87ed827b30b4771ea8;
Node v24.16.0 / esbuild 0.28.0; real packed tarballs.

`provePackedInstallLoading(root, await measureClientBundles())`: RED,
`toolchain has no first-use install entry`; installLoad=null and actual npm /
shadow catalog / generated-adapter inputs contribute to toolchain stdin.js.
Carrier: tests/integration/no-coi-install-browser-proof.mjs, invoked by packed
surface runner. Source maps identify generated adapter input across tsup chunks;
request ledger checks boot/eval/fs and first install/restore. Empty-manifest
install runs the real installer; existing real Vite tests own build/HMR/restart.

Sweep: no-coi worker's installManifest/restoreActivation are the two heavy
entry paths. runBin/startBin need activated runtime only. The worker owns
busy admission, runtimeBackend and recovery snapshots; native module import
caching suffices, no added coordination mechanism. The existing Worker
transport excludes duplicate/reordered delivery; held network response and
second operation exercise actual busy admission. Fetch abort exercises both
first-use operations and keeps the same Worker for postfailure eval/fs.
