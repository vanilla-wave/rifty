## Items

1. `distribution/browsers-compat-matrix` — **matrix v1** — browsers.md with the persistence axis, computed floors, today's executed rows (Chromium 148 ✅, Firefox 150 ✅, WebKit 26.4 ⚠ with what ran), the Safari ephemeral cell ❌ (P1) until item 3 lands, cut-off rows, share over all tracked traffic; this slice alone delivers the argued answer, later slices upgrade marks → I1, I9.
2. `toolchain-build/es-floor-guard` — **Chrome 108 + floor cannot drift** — rewrite the nine `toSorted` sites + the playground `findLast`, check lane over shipped bundles (packages + playground) with an ES2022 ceiling + named allowlist → I2. Independent of 1; cells move when it lands: Chrome/Edge 110 → 108, Chrome Android 110 → 109, Opera 96 → 94, Firefox 115 → 114.
3. `vfs/opfs-createwritable-capability-gate` — **loud gate** — backend selection requires `createWritable`; capability error at boot → I3. Independent.
4. `vfs/opfs-root-unavailable-loud-throw` — **named storage error** — an unavailable OPFS root under `required` is a storage-unavailable error, not `NotImplementedError('sandbox.toolchain.worker')` + worker crash → I4. Independent.
5. `playground/no-coi-lane-firefox-webkit` — **non-COI on 3 engines** — projects, WebKit persistent-context fixture (incl. `checkSandboxSupport` under it), version-pin carrier (annotation or explicit chromium scoping), manual dispatch, named-run rows → browsers.md → I5. After 1.
6. `playground/coi-lane-cross-engine-record` — **repair + run + record** — fix the `ci-cross-browser.yml` command bug and launcher reds, manual-only (cron removed), classify, named-run rows → browsers.md → I6. After 1. Items 5 and 6 share one manual-dispatch workflow (agent carrier).
7. `toolchain-build/floor-smoke-lane` — **floor executed** — old builds Chrome 108 / Firefox 114 / WebKit 26.0, boot → install → build → reload → reopen, on demand → I7. After 1 and 2 (a Chrome 108 run before the rewrite fails on `toSorted`); carrier question open.
8. `distribution/real-browser-manual-protocol` — **real Safari / iOS / Yandex** — one URL + result block; user runs on own hardware; rows → browsers.md → I8. After 7 (shares `--executable-path` carrier) or standalone page.

## Open questions

- WebKit OPFS contention error name (Chromium/Firefox: `NoModificationAllowedError`, the only name `opfs-replica-store.ts:57-67` retries) — owner: agent — probe under `launchPersistentContext` in item 5.
- CSP inheritance into module workers on Firefox/WebKit (loader = `new Function` + indirect eval; Chromium takes the worker response's policy) — owner: agent — one run per engine with a document CSP lacking `unsafe-eval`; result → cut-off row in item 1/5.
- Which old Playwright releases bundle Chrome 108 / Firefox 114 / WebKit 26.0 (expected ≈ 1.28 / 1.35 / 1.55–1.56) and whether a pinned old runner is needed per engine (new runner cannot drive an old Firefox; CDP compat with old Chromium unverified) — owner: agent — settles at item 7 pickup.
- Transport for the iOS row (https reachable from the device: deployed playground vs local tunnel) and memory signal (`performance.measureUserAgentSpecificMemory` availability per engine) — owner: agent — design at item 8 pickup.

## Out of scope

- Widening Safari persistent below 26 (replica on sync-access-handle writes) — question `vfs/safari-pre-26-replica-without-createwritable`; user 2026-09-27 "2a".
- COI on WebKit via `COEP: require-corp` (D-001 supersession) — question `distribution/coi-on-webkit-require-corp`; user 2026-09-27 "2a".
- Firefox <145 in COI (`Atomics.waitAsync` polyfill) — question `kernel/firefox-pre-145-coi-waitasync-polyfill`; user 2026-09-27 "2a".
- Any scheduled lane or release gate — user 2026-09-27 "пока без расписания".
- Fixing Firefox/WebKit product reds found by items 5/6 — user 2026-09-27 "Только записать"; each red becomes a draft finding outside the epic.
- Gates of external embedding hosts (their own capability checks) — outside this repo.
- Android device memory beyond what item 8's protocol observes — no device farm.
