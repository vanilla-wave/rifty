---
area: vfs
status: draft
title: Skip redundant mkdir persist ops for already-existing paths in OpfsFsSync
created: 2026-08-15
why: mkdirSync enqueues a persist op even when every segment already exists; restore paths mkdir before every write → ~2 FIFO ops/file, measured 1.3-1.8x of the whole durability drain
user_story: As a developer opening a project from a baked dep snapshot, I want the durability flush to not re-persist thousands of already-persisted directories, but today a 26.8k-file tree drains ~2 ops per file and the flush alone takes 40+ seconds
epic: project-open-drain-latency
sources: [https://github.com/vanilla-wave/rifty/issues/256, docs/adr/vfs/0072-opfs-sync-content-cache-write-through.md, docs/adr/playground/0187-install-stamp-durability-via-write-through-fifo-order-non-blocking-stamp.md]
code: [packages/vfs/src/opfs-sync.ts, packages/workbench/src/glue/workspace-archive.ts]
---

## Context

`OpfsFsSync.mkdirSync` (opfs-sync.ts:950) calls `persistMkdirAsync`
unconditionally — the existence loop only `continue`s over known segments, then
persists anyway. Restore/apply loops (workspace-archive.ts:230 and siblings)
call `mkdirSync(dirname(target), {recursive:true})` before EVERY
`writeFileSync`, so a big-tree drain carries one redundant mkdir persist per
file.

Measured (prototype branch `proto/opfs-flush-speed-256`, commit a01870a5f,
`tests/browser-unit/proto-opfs-flush-speed.spec.ts`, real npm-installed
gravity-ui tree 26 811 files / 166.8 MB / 2 314 dirs, Chromium via
Playwright 1.60.0, headed, `fssync-FAITHFUL` vs `fssync-mkdir-dedup`
variants): faithful 48.9/42.1 s vs dedup 26.7/31.0 s → 1.4-1.8x; headless
37.6 s vs 28.5 s → 1.3x. Serial-only fix, no FIFO/ordering change.

Correctness constraint (why "path exists in mirror" alone is NOT enough to
skip): existing-in-mirror does not imply persisted-in-OPFS. A prior mkdir
persist may have FAILED (quota/perm) leaving a ledger entry; today a later
mkdirSync of the same path re-persists and heals it. A skip must preserve
heal-on-retry: skip only when the full path pre-existed AND no persist-failure
ledger entry covers any of its segments (or an equivalent condition proven at
Contract+RED). `healAncestorPersistFailures` (write success proves ancestors)
interacts here — a child write already heals ancestor mkdir failures, which may
make the ledger check cheap or even redundant; settle at contract time.

Fault rows to pin (fault-classes: `quota-perm-fail`, `torn-state` at the
Storage boundary): (a) mkdir persist fails → later mkdirSync of same path
still heals (no skip on ledgered path); (b) skip of a truly-persisted dir
leaves flush report clean and stamp promotion unaffected; (c) mixed: parent
ledgered, child new → child write-through still heals ancestors.

Epic: `project-open-drain-latency` (slice **mkdir-dedup**, lands first).
REVERSIBLE mechanism-local change, but persistence-touching → Review
convergence Contract+RED applies.
