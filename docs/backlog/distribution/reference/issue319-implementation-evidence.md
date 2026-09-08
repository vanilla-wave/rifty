# PR #321 implementation evidence

## I3 reported persistence failure

Baseline 6288fe1f188ed4e8f055a7b8d50d3d7ba267ed39; real Chromium/no-COI SDK,
Worker, Memory VFS mirror + native OPFS. Only native createWritable rejection
injected; no product substitution. npm empty manifest produces real lockfile;
real CLI writes output.txt.

Command: `RIFTY_NO_COI_PORT=5511 RIFTY_NO_COI_ORACLE_PORT=5512 RIFTY_NO_COI_RESOURCE_PORT=5513 pnpm test:no-coi no-coi-persistence.fault.spec.ts`.
RED: 2 failed; install and build both returned `{resolved:true}` despite native
QuotaExceededError. First CLI fixture attempt used an unsupported launcher;
corrected to existing emitted launcher form before capturing the two REDs.

Root: no-coi-toolchain-worker flushMirror casts away PersistFailureReport.
Class quota-perm-fail/provenance-lie; storage boundary. Sibling install/run-bin/
restore-activation share flushMirror and now the complete `total` check.
Other workbench durability consumers already inspect total. Generic runtime eval/
fs use the same cast; evaluated separately before warm-open proof relies on them.
No lost/reordered OPFS operation exclusions assumed.

GREEN I3: same command, 2 passed (4.8s); both failures settle as explicit errors.
I4 RED: `RIFTY_NO_COI_PORT=5511 RIFTY_NO_COI_ORACLE_PORT=5512 RIFTY_NO_COI_RESOURCE_PORT=5513 pnpm test:no-coi no-coi-install-dedup.spec.ts`: 1 failed, expected zero writes/mkdir; actual index.js writes=4, nanoid mkdir(create)=5. Same-length repair passed before count assertion.

## Integrated implementation

- Native OPFS preload: 14 browser cases pass, VFS unit 239 passed/1 skipped. Eight files: root/directory/fileHandle/getFile 2/24/8/16 → 1/0/0/8; exact bytes, true-empty, fresh native reads and native receiver/deletion behavior preserved.
- Installer equality proof: `RIFTY_PLAYGROUND_PORT=5355 pnpm test:browser-unit install-mirror-proof.spec.ts` passes. Clean file 0 writes; generic same write 1; empty file 1; alias mutation persisted correctly; quota report1→healed0; existing failed directory report1→healed0; pending writes before/during native read cannot overwrite the desired final bytes.
- Pending predicate revert-check: deleting scheduler eligibility makes final native bytes `late` instead of `heal` (test exit1). First alias-only pending probe survived because cache and pending write share one defensive slice; corrected repro uses real `preloadContent()` while native write is held, preserving a distinct pending buffer. No product change was needed for the stronger carrier.
- Runtime preload error RED: public createSandbox resolved despite denied native getFile. After tagged preload error and existing Worker-error settlement, boot rejects with native cause and saved bytes remain. Dedicated pending-request carrier waits for the real runtime listener while native preload is held, then sends eval/fs and rejects the native read; both calls reject without ready.
- Command: `RIFTY_NO_COI_PORT=5551 RIFTY_NO_COI_ORACLE_PORT=5552 RIFTY_NO_COI_RESOURCE_PORT=5553 pnpm test:no-coi no-coi-preload-failure.spec.ts`.
- Warm activation, cached repair, request/authority drift, nested install, quota and dedup: integrated Chromium 16/16; details and required supporting REDs in no-coi-warm-open-red-evidence.md.

- Preload-refusal revert-check (controlled native read after real listener installation): removing the OpfsPreloadError guard makes toolchain boot resolve and pending eval fulfill instead of rejecting. Restoring the guard: both tests GREEN. No product or test timeout changed.

## Integrated gate inventory

Final gate on main-integrated ae4ecd4: 24/25 lanes passed; test:run reproduces only extraction-boundary inventory count141 vs145 (0 timeouts). Four added Workbench modules are the shared claim guard, thin claim FS, no-COI composition context and install-only Vfs. Update count to145; keep exact closure equality, runtime reachability and all forbidden import checks. PR-4 final review compares the old/new criterion; no product assertion is weakened.

## Final executed acceptance

Source: main-integrated 7c057344260c2bab74dd4002f00fd97f6a26f565; subsequent
no-coi spec edit adds counters/timing only. Chromium 148.0.7778.96.

- `pnpm test:packed-toolchain-surface`: PASS, 15 first-party + 72 external tarballs, strict TS and actual packed SDK/Worker browser graphs.
- `RIFTY_PLAYGROUND_PORT=5366 pnpm test:e2e:prod`: 7/7 PASS (2.5 min), including production owner boot and real package journeys.
- `RIFTY_NO_COI_PORT=5511 RIFTY_NO_COI_ORACLE_PORT=5512 RIFTY_NO_COI_RESOURCE_PORT=5513 pnpm test:no-coi no-coi-warm-open.spec.ts no-coi-install-dedup.spec.ts no-coi-persistence.fault.spec.ts no-coi-preload-failure.spec.ts`: 18/18 PASS (28.0s). Full-page Vite 7.3.6 activation/preservation/cached repair case: 9.9s total.
- `RIFTY_PLAYGROUND_PORT=5355 pnpm test:browser-unit opfs-preload-handles.spec.ts install-mirror-proof.spec.ts`: 7/7 PASS (4.6s).

Counts and elapsed time are separate observations, not latency guarantees:

| Operation | Native counts | Elapsed |
| --- | --- | --- |
| Eight-file paired boot | root 1, directory lookup 0, fileHandle 0, getFile 8 (baseline 2/24/8/16) | 1.8ms |
| nanoid 3.3.18 explicit repeat install | writable 3, directory lookup 120, fileHandle 36, getFile 26; unchanged index.js writes 0 and nanoid directory creates 0 | 15.8ms |
| Same nanoid cold install | no comparative latency claim; includes first acquisition | 510.6ms |

Original repeat-install baseline counted 26 writable acquisitions. Final three
remaining writes are installation metadata; persisted-equal package writes are
skipped. Vite is exercised as acceptance, not used as infrastructure policy.

## Closure

Final source gate: `VITEST_MAX_THREADS=4 VITEST_MIN_THREADS=1 VITEST_MAX_FORKS=4 VITEST_MIN_FORKS=1 pnpm pr:check` PASS, all 25 lanes; test:run 184.6s and parity 62.6s, no retries. Only worker count was limited; all assertions, lanes and timeout criteria stayed intact.

Independent `/root/goal_final_review`: Final+GREEN PASS on a013f8ae7ee1861fa6f2d7b423402f94968a8c4c, 45/45 coverage, no findings. Independently executed extraction/stamp-writer criteria 17/17 and the existing successive OPFS-memory-OPFS recovery case 1/1 (4.9s); raw recovery command uses no-coi-dev-hmr.spec.ts with grep `successive OPFS-memory-OPFS` and ports 5561/5562/5563.

All accepted I1–I5 obligations proven. Completed goal/child documents and the consumed unreadable-preload finding are removed; their accepted source and history remain at the reviewed revision. Existing generic directory-healing and cross-realm coherence backlog owners retain their separate scope. PR #321 delivers implementation; merge is outside this hand-off.
