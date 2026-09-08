# Dependency snapshot tar proof

## Baseline / RED — 2026-09-08

PR #316 baseline 89724666236755df26b74ee033c05a1743093353.
Node v24.16.0; Vitest 2.1.9; system bsdtar 3.5.3 (PAX format).

`pnpm exec vitest run packages/workbench/src/glue/dep-snapshot-tar.test.ts`

4 failed / 7 passed: tar and gzip are rejected as invalid JSON; writer absent;
verified tar fails JSON parsing. Negative admission cases already reject on
legacy parse. No import/typecheck failure. Fixtures use system tar, real
MemoryFsSync, and only replace external HTTP fetch. The writer test lists and
extracts output with system tar, including a long UTF-8 filename.

Earlier fixture attempts used unsupported bsdtar `--format=gnu` and a Node
Buffer backing allocation in Response. Corrected to standard PAX and copied
Uint8Array body before this RED; those harness failures are not product proof.

Legacy reader/replay/cache carriers remain in `dep-snapshot.test.ts`; byte-cap owner is covered by `bounded-asset-fetch.fault.test.ts`.

Review found macOS AppleDouble sidecars and fault edits targeting PAX headers.
The fixture now disables copyfile metadata and locates the actual regular-file
header before corruption; payload attacks keep the control manifest intact.

## Implementation regression — 2026-09-08

`pnpm exec vitest run packages/workbench/src/glue/dep-snapshot-tar.test.ts -t "literal POSIX"`: RED, unsafe-path rejection on literal backslash accepted by Memory VFS. Removed Windows path restrictions from this POSIX envelope; slash traversal/collisions remain rejected. The test restores exact VFS bytes and extracts the literal name with system tar.

## Gate inventory adjustment

First `pr:check` reproduced one test failure in isolation (zero timeouts):
`extraction-boundary.contract.test.ts` pinned 141 production files; the new
codec makes 142. Update only that count; exact closed-graph equality and
unreachable-runtime checks remain. This is an inventory update under PR-4,
not removal of a behavior assertion.

## GREEN / accepted codec

Commit fd829ca42ba698c168e5442278a3e5d50ffbbc7f: full `pnpm pr:check`25/25 PASS after the inventory adjustment. Scoped tar/legacy/archive/fault/cap suite81/81. Fresh Final+GREEN reviewer additionally ran extraction and POSIX/UTF-8 boundary probes:82/82 tests and11 path cases, no blockers. Verdicts retained beside this evidence; producer/public packed-consumer and full goal proof remain separate obligations.
