---
area: vfs
status: draft
title: Require createWritable in OPFS backend selection so a Safari-15–25 realm falls back to memory under preferred and is refused at boot under required, never selecting OPFS and losing data
created: 2026-09-27
why: `OpfsFsSync.isSupported()` checks only `createSyncAccessHandle`; both durable write paths call `createWritable()` unguarded; a realm with sync handles but no `createWritable` selects opfs, fails the first write with `SandboxPersistenceError`, keeps accepting writes into memory and loses them on reopen with no signal, while `checkSandboxSupport` says unsupported — runtime and probe disagree
epic: browser-support-floor
sources: [docs/backlog/distribution/reference/browsers-compat-matrix-evidence.md, docs/backlog/playground/reference/no-coi-lane-firefox-webkit-evidence.md, ADR-0372, ADR-0437]
code: [packages/vfs/src/opfs-sync.ts, packages/vfs/src/boot.ts, packages/vfs/src/opfs-replica-store.ts, packages/vfs/src/opfs.ts, packages/workbench/src/support/support-worker.ts]
---

## Context

Finding. `packages/vfs/src/opfs-sync.ts:135-146` `isSupported()` = worker realm ∧ `FileSystemFileHandle.prototype.createSyncAccessHandle`. `boot.ts:64` → `'opfs'`; with `storage` given `boot.ts:88` picks `replica`. `opfs-replica-store.ts:93 writeNative` and `opfs.ts:148 writeFile` call `file.createWritable()` with no feature detect; the raw `TypeError` message is stored by `recordPersistFailure` (`opfs-sync.ts:590-611`) and surfaces as `SandboxPersistenceError` (constructor `Error`, no code — not via `mapOpfsError`). BCD: `createWritable` Safari 26 (2025-09-15); `createSyncAccessHandle` Safari 15.2, sync methods 16.4 → every Safari/iOS 15.2–25 realm has the failing shape (Safari + iOS 16.4–25.x = 4.895 % global / 1.784 % RU of all tracked traffic, caniuse-lite 1.0.30001793, computation in the research evidence appendix; the research's 3 / 1.2 p.p. were over the external host's admitted traffic).

Observed (research §3.1, rifty 0.8, Chromium 142/148 with the API deleted before hoisted imports): boot → `vfsBackend: 'opfs'`; `openProject()` rejects in 3 ms `SandboxPersistenceError: OPFS persistence failed (2 unhealed): /<project>: (intermediate value).createWritable is not a function; …`; retry grows unhealed 2 → 3; warm read path works, build does not; no feature-detect branch exists (byte-identical failure with a pre-import shim). `checkSandboxSupport` (`support-worker.ts:143`) does exercise `createWritable` → its `opfs` check fails → probe and runtime disagree. Probe P1 on main 2026-09-27 (Chromium 148, API deleted in the worker realm before hoisted imports; evidence file §Probes): backend `opfs` under `required`, `preferred` and no option — `preferred` never falls back; boot 67–73 ms; first `fs.writeFile` fails after 2 ms `SandboxPersistenceError: OPFS persistence failed (1 unhealed): /saved.txt: file.createWritable is not a function`; the in-memory copy keeps the bytes, `project.run` resolves `{status:'failed', effects.persistence:'failed'}`; unhealed set grows 1 → 2, every later write/flush/run reports the whole set; reopen → `VfsError ENOENT` — data lost with no signal, next flush says `flushed`; `capabilityReport` identical to control (`fs: working`, `npm.install: working`); `checkSandboxSupport({persistence:'required'})` → `unsupported`, unmet `["opfs"]`, reason `opfs: TypeError: file.createWritable is not a function`.

Contract (user 2026-09-27 "1a"): `persistence: 'required'` → named loud throw at boot (capability error naming `FileSystemFileHandle.createWritable`), never a persistence error after writes were attempted; `'preferred'` (default) / no option → memory backend with the reason exposed, exactly the existing OPFS-unavailable fallback (ADR-0372; probe P2 shows it for a rejecting root) — this makes Safari/iOS 16.4–25 run ephemeral, the non-COI ephemeral floor of the matrix. Adjacent: `distribution/iframe-embed` option (b) "loud capability gate"; `epics/embeddable-dev-loop` step 5. → I3.

## Challenge

<!-- Premise checked at goal FIT 2026-09-27 (goal.md §Challenge); recheck at PICKUP only for changed promises. -->

## Out of scope

Persistent admission of Safari <26 via sync-access-handle writes — question `vfs/safari-pre-26-replica-without-createwritable`; memory fallback under `persistence: 'required'` (must stay a throw, ADR-0372); Chrome 102–107 (async sync-access-handle methods, `createWritable` present) passes this presence gate and still selects OPFS — its runtime behavior is unverified and its cell stays `❓` (≈ 0 traffic, 2022 builds), not a loud throw.

## Decisions

- 2026-09-27 — gate lives in backend selection (worker realm), not in the write path — agent, carrier; this changes ADR-0372's selection predicate (sync capability alone) → short ADR at pickup citing ADR-0372 and ADR-0469
