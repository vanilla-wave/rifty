# Client budget proof

2026-09-13: `pnpm test:client-bundles --keep` passed on merged main
`db50e46b24ac82a0c77514c44bf888b3c99c5c1e`: 15 first-party + 72 external
tarballs, strict TypeScript, splitting/minification and fresh Chromium 148.
Node 24.16.0 / esbuild 0.28.0. Report includes readiness-joined JS requests.

User accepted rebaseline after PR #299's segmented OPFS and SDK/toolchain growth.
Same rule: measured cleaned bytes ×1.5, rounded up to 1000 B. Keep the lazy
`default-vfs` entry and its measured provenance: no product shrinkage for the gate.

| Artifact | cleaned min/gzip B | old ceiling min/gzip B | new ceiling min/gzip B | reintroduced leak min/gzip B |
|---|---:|---:|---:|---:|
| main | 85184 / 26630 | 86000 / 28000 | 128000 / 40000 | 140987 / 42351 |
| sw | 15220 / 5327 | 22000 / 8000 | 23000 / 8000 | 70693 / 20898 |
| generic | 748921 / 220937 | 1089000 / 321000 | 1124000 / 332000 | 4301313 / 1242200 |
| toolchain | 855453 / 256720 | 1196000 / 355000 | 1284000 / 386000 | 4407688 / 1277813 |

PR-4 criterion change: the original 2026-09-07 main leak (103660 / 30188 B)
fits the new cap. Reintroduce the same fault class into today's actual tarballs
and measure again; do not compare a larger current baseline to an old smaller
leaking program. `historical` and `previousCleaned` retain the original reports.
`cleaned` and `leaked` carry the new reports and actual browser request ledgers.

Reproduction after the packed command retains its consumer directory:

```js
const { measureClientBundles } = await import(`${consumer}/measure-bundles.mjs`);
const { observePackedWorkerBoot, accountPackedBootRequests } =
  await import('./tests/integration/client-bundle-browser-proof.mjs');
const report = await measureClientBundles({ injectLeaks: true });
const boot = await observePackedWorkerBoot(consumer, report);
await accountPackedBootRequests(consumer, report, boot);
```

Leak calibration retains the real io namespace in main/SW and the actual
source-map-identified browser compiler in generic/toolchain eager graphs. Fresh
Workers reach readiness (3 samples each). Raw npm TypeScript is not this browser
oracle: an initial probe failed at `platform()` after Worker globals installed;
the accepted probe uses the runtime's shipped browser compiler.

Every new leak crosses both byte ceilings. Existing compiler-eager,
missing artifact/provenance/observation and unaccounted-boot-JS assertions remain.
The independent packed SDK io-provenance guard (≤5120 B) is unchanged; so are
compiler eval/preload/fetch faults, VM/SDK/install/agent behavior proofs.

Final repaired tree packed run also passed (15 + 72 tarballs): main
85204 / 26641 B, SW 15220 / 5327 B, generic 748941 / 220949 B, toolchain
855473 / 256725 B. Baseline calibration stays pinned to merged main, before
the two repairs. `pnpm test:run tools/checks/client-bundle-budget.test.ts`: 4/4.
