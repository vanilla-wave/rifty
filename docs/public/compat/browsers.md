# Browser support — 2026-09-28

Hand-maintained, dated evidence; ADR-0469. Node API compatibility is a separate axis.
A computed version floor is **not** an executed support claim. Run
`checkSandboxSupport` in the actual host; CSP, storage and memory can refuse a recent browser.

Legend: `N` computed minimum; `⚙N` prerequisite probe only; `✅N` named lane passed
on that build; `⚠N` lane with recorded product failures; `❌` unsupported with reason;
`❓` not characterized. A Playwright WebKit build is not Safari.
Chromium is supported/gating; Firefox verified and WebKit capability-verified are
record-only (manual dispatch, no schedule, no release gate).

## Computed minimums

Numbers below are computed, **no ✅**. ES2022 ceiling + guarded optional builtins.
Persistent = `persistence: 'required'`, OPFS replica. Ephemeral = explicit memory.
Default `preferred` uses OPFS when available, otherwise memory with the reason in
`vfs.reason`; missing `FileSystemFileHandle.createWritable` now takes that fallback.
`required` refuses the missing API at boot; root failure retains the native cause.

| Mode / persistence | Chrome | Edge | Firefox | Safari macOS | Chrome Android | Safari iOS | Samsung Internet | Yandex |
|---|---|---|---|---|---|---|---|---|
| Non-COI / ephemeral | 98 · clone | 98 · clone | 114 · modules | 16.4 · decompress | 98 · clone | 16.4 · decompress | 18 · clone | ❓ exact build needed |
| Non-COI / persistent | 108 · sync OPFS | 108 · sync OPFS | 114 · modules | 26 · writable | 109 · OPFS | 26 · writable | 21 · OPFS | ❓ exact build needed |
| COI / ephemeral | 98 · clone | 98 · clone | 145 · waitAsync | ❌ credentialless | 98 · clone | ❌ credentialless | 18 · clone | ❓ exact build needed |
| COI / persistent | 108 · sync OPFS | 108 · sync OPFS | 145 · waitAsync | ❌ credentialless | 109 · OPFS | ❌ credentialless | 21 · OPFS | ❓ exact build needed |

Bindings: clone = `structuredClone`; modules = module Workers; decompress =
`DecompressionStream`; writable = `FileSystemFileHandle.createWritable`; sync OPFS =
synchronous `getSize/truncate/flush/close`. `Atomics.waitAsync` is optional/guarded
in shared code but required by the COI support probe. D-001 requires
`COEP: credentialless`; WebKit ignoring it is the COI exclusion. No `require-corp`
widening is claimed. Opera computed floors: ephemeral 84, persistent 94; Opera
Android 68/74. Chrome 102–107 persistence is unverified: presence detection alone
does not certify the older asynchronous handle methods.

Bindings use MDN BCD 8.1.1 (retrieved 2026-09-28), prior pinned research and the
ES2022 shipped-bundle guard. Shipped `toSorted`/`findLast` uses were rewritten;
`pnpm check:es-floor` rejects newer builtin callsites/syntax. The guard's named
own-method exceptions distinguish Monaco/TypeScript methods from Array builtins.

## Executed observations

Historical raw artifacts remain dated, not retroactively greened by a later fix:

| Run | Engine/build | Result and limits |
|---|---|---|
| 2026-09-16, three-engine no-COI command | Chromium 148.0.7778.96 | ✅148, 100/100 |
| Same run | Firefox 150 | ✅150 behavior; 99/100, remaining failure was a Chromium-version assertion in the test |
| Same run, ephemeral Playwright context | WebKit 26.4 | ⚠26.4, 41/100; storage root unavailable, required-mode storage failure misreported as worker NotImplementedError; two spec waits; no Safari claim |
| Same run, persistent context reruns | WebKit 26.4 | ✅26.4 for replica-storage and exact-byte reload only; full lane unproven by these two flows |

Raw historical commands/results:
[no-COI evidence](../../backlog/playground/reference/no-coi-lane-firefox-webkit-evidence.md).
Current cross-engine commands, build IDs, failure classes and native API probes:
[cross-engine evidence](../../backlog/playground/reference/browser-floor-cross-engine-evidence.md).
Storage fault RED/GREEN:
[admission evidence](../../backlog/vfs/reference/browser-support-storage-evidence.md).

Named manual [CI run 36356372850](https://github.com/vanilla-wave/rifty/actions/runs/36356372850),
2026-09-28 local date, source850eeee26, Playwright1.60.0 on Ubuntu:

| Non-COI engine/build | Result | Classification |
|---|---|---|
| Chromium148.0.7778.96 | ✅148 · 110/110 | full lane passed |
| Firefox150.0.2 | ✅150 behavior · 109/110 | delayed-rival test expects a race after admission but it fires before admission under CI; recorded test-infra; local case passed |
| WebKit26.4 (Linux) | ⚠26.4 · 40/110 | 66 missing-OPFS/downstream fixture failures, 1 credentialless COI assertion, 1 absent route barrier, 2 replacement/restart ENOENT findings |

Same named run, COI suite:

| Engine/build | Result | Classification |
|---|---|---|
| Chromium148.0.7778.96 | ✅148 · 197 passed, 4 existing skips | skips: retired dev-HMR, opt-in HMR/manual-install, existing mouse-reporting gap |
| WebKit26.4 Linux | ❌ COI · 0 passed, 12 failed, 185 not run after failure limit, 4 declared skips | all 36 attempts: host reports cross-origin isolation inactive; `credentialless` capability-missing, downstream launcher waits |
| Firefox150.0.2 | ⚠150 · 0 passed, 12 failed, 185 not run after failure limit, 4 declared skips | all 36 attempts remain at `Booting rifty`; engine boot-stall, root cause unisolated; not classified as missing API |

The delayed-rival fixture was subsequently repaired with an entry-admission marker;
its expected ownership assertion remains. Exact CI failure reproduced under a1s RPC
delay, repaired scenario and sibling cases passed in Chromium/Firefox. Historical
109/110 above is unchanged. [Repair proof](../../backlog/playground/reference/pr362-resident-rival-ordering-evidence.md).
Firefox COI [boot-stall finding](../../backlog/playground/firefox-coi-playground-boot-stall.md)
retains the unknown cause; no product repair or COEP change is included.

Linux WebKit lacks `navigator.storage`/`FileSystemFileHandle` in this build even in
a persistent context. macOS26.4 native OPFS and exact-byte reload passed; platforms
are not interchangeable. macOS support-probe handle transfer separately throws
`DataCloneError` (direct Window→Worker `postMessage(directory)` probe); this does
not establish that worker-local OPFS is absent. Details and findings: cross-engine evidence above.

Current Chromium148 manual protocol passed install/build/flush/reload/exact-byte
reopen/rebuild: [composed report on clean ef446585d](../../backlog/distribution/reference/browser-manual-chromium-final.json).
macOS WebKit26.4 runs the same complete sequence successfully, but the support probe
fails its handle-clone boundary; [overall report stays fail](../../backlog/distribution/reference/browser-manual-webkit-final.json).
Floor command: `node tools/floor-lane/run.mjs --engine chromium|firefox|webkit` against
the headerless host. [Chrome108 finding](../../backlog/runtime-js/chromium108-sdk-sync-wasm-import.md),
[Firefox114 beta finding](../../backlog/vfs/firefox114-beta-reopen-missing-bytes.md),
[WebKit26 launch artifact](../../backlog/toolchain-build/reference/webkit260-floor-harness.json).

Floor builds and manual hardware rows: A floor
harness failure stays `❓`, never a product `❌`. Firefox's pinned available
114.0b3 is a beta; it cannot certify stable Firefox 114.

| Floor / real hardware | Dated observation | Storage / memory / eviction |
|---|---|---|
| Chromium 108.0.5359.29 | ❌ 2026-09-28: SDK import throws on main-thread sync WASM >4KB | no boot/storage steps reached |
| Firefox 114.0b3 beta (UA114.0) | ❌ 2026-09-28: install/build/flush pass, saved source ENOENT after reload | OPFS selected both boots; namespace unchanged; stable114 still uncharacterized |
| WebKit 26.0, macOS26.6 | ❓ 2026-09-28: pinned runner fails `Playwright.setDownloadBehavior`: no default context | harness cannot launch; not a product failure or Safari result |
| Safari26.6.2 macOS, real device | ❓ 2026-09-28: WebDriver refuses session (Remote Automation disabled); manual run still required | estimate + steps absent; memory/eviction unobserved |
| Safari iOS, real device | ❓ 2026-09-28: awaiting user hardware run | estimate + steps absent; total-memory API unavailable on non-COI; revisit required |
| Yandex26.8.0.0 / Chromium150, macOSarm64 | ✅ 2026-09-28: actual installed browser, isolated headless profile; all protocol steps passed | quota10,767,150,993 B; usage29,732,753 B; memory/eviction unknown |

[Native Yandex report](../../backlog/distribution/reference/browser-manual-yandex-native.json),
clean a57da96b8: `node tools/floor-lane/run.mjs --current --executable-path
/Applications/Yandex.app/Contents/MacOS/Yandex --url http://127.0.0.1:5611/browser-support.html`.
This measures that desktop build/profile, not all Yandex versions or mobile devices.
[Safari driver response](../../backlog/distribution/reference/browser-manual-safari-driver-unavailable.json)
is a harness limitation, not a Safari failure; settings were not changed.

Use the [one-URL protocol](../../../tools/floor-lane/README.md). One report includes
support, boot, install, build, reload, exact persisted bytes, reopen and rebuild.
`browser-floor.yml` and `ci-cross-browser.yml` run only on manual dispatch; copy their
run ID + build + classified result here. A successful job alone is not evidence:
record-only jobs deliberately retain failing reports.

## Cut-offs unrelated to version

| Constraint | Consequence / evidence |
|---|---|
| Secure context | HTTPS or loopback required for storage, crypto, SW. LAN HTTP is insufficient. |
| CSP | Runtime loader needs eval in its Worker response policy. Chromium 148 / Firefox 150 / WebKit 26.4 probes: document `script-src 'self'` does not prohibit eval in an external module Worker; worker response CSP does (`EvalError`). Inline/blob workers and actual deployment policy still require a host probe. |
| Private / partitioned storage | OPFS may be absent or deny root access, notably Firefox private mode. Required persistence rejects with native storage cause; preferred reports memory fallback. Profile/embedding policy matters. |
| Safari Lockdown | Web Locks may be unavailable; computed version alone cannot admit the host. Not executed on a real Lockdown device. |
| Quota / eviction | Storage estimate is diagnostic, not a reservation or durability guarantee. ITP/OS/manual cleanup can remove data. Revisit the same origin/profile after seven days; no observed eviction guarantee. |
| Mobile memory | ❓ build peak and OS tab termination unmeasured. Page JS heap is not total resident memory; record device/OS observation. |
| Transferable ReadableStream | Chrome 89 / Firefox 103 / Safari 16.4 computed fast-path floors. Existing body-transport buffering fallback; this does not raise the table's floor. |
| OPFS contention | Persistent-context probe: Chromium/Firefox `NoModificationAllowedError`; WebKit 26.4 `InvalidStateError`. Retry policy difference recorded in backlog; no blanket WebKit persistence guarantee. |

## Traffic estimate, 2026-09-28

caniuse-lite **1.0.30001810**, BCD **8.1.1**. Numerator = all version buckets at or
above the stated computed floors; denominator = **all tracked traffic**, not a
`browserslist defaults`/admitted-client subset. Range bucket counts only if its
lower endpoint meets the floor. Unsupported/unmapped agents stay in the denominator.
COI excludes Safari/iOS and requires Firefox 145. This is API eligibility, not device
success probability; CSP, memory/private mode and product reds are not measured by usage weights.

| Mode / persistence | Global numerator / tracked | % tracked | RU numerator / tracked | % tracked |
|---|---|---|---|---|
| Non-COI / ephemeral | 94.166 / 96.688 | 97.39% | 43.688 / 66.658 | 65.54% |
| Non-COI / persistent | 89.841 / 96.688 | 92.92% | 40.558 / 66.658 | 60.84% |
| COI / ephemeral | 77.205 / 96.688 | 79.85% | 36.016 / 66.658 | 54.03% |
| COI / persistent | 76.654 / 96.688 | 79.28% | 34.476 / 66.658 | 51.72% |

Numerators retain caniuse's original percentage-point weights; ratios normalize only
the explicitly shown tracked sums. **RU coverage gap:** just 66.658 points tracked;
Yandex is absent, not added to Chrome. Global tracked sum is 96.688. Chrome Android
and Firefox Android are single current-version buckets, so older mobile versions are
not resolved; no measured-device precision is implied. Yandex's Chromium base cannot
be used to invent its traffic version distribution.

[Reproducible computation](../../backlog/distribution/reference/browser-floor-share.cjs)
and [frozen output](../../backlog/distribution/reference/browser-floor-share.json).
Install data separately (`npm install --prefix /tmp/browser-data --ignore-scripts
caniuse-lite@1.0.30001810 @mdn/browser-compat-data@8.1.1`), then pass its `node_modules`
path to the script. Matrix itself remains hand-maintained.

StatCounter cross-check in the [dated research](../../backlog/distribution/reference/browsers-compat-matrix-evidence.md),
August 2026: Yandex 26.26% RU all-platform traffic versus 0.28% global; Chrome
51.56% RU / 69.28% global. Different source/population, not a correction factor.
The research's 96.7%/97.8% ratios used an external host's admitted browserslist;
they are not this table's denominator or rifty's device coverage.
