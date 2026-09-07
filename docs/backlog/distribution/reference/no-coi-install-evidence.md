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

GREEN packed first-use/fault proof: install and restore each load once, reuse
the native module, both real fetch aborts reject with Chromium's native error;
same Worker eval/fs remain usable. Held first import rejects overlap with
existing SandboxToolchainBusyError, completes after release and remains reusable.
Complete eager toolchain graph: 966,094 → 796,895 B min; 288,598 → 236,199 B gzip.
No npm/catalog/generated adapter inputs in boot requests/eager graph.

Initial browser setup incorrectly called RuntimeFs.mkdir; that host interface
only reads/writes, and writeFile already creates parents. Removed the invalid
setup call, retaining every assertion; focused real packed proof then passed.
Strict packed typecheck/build and preceding compiler/VM/SDK proofs also passed.
