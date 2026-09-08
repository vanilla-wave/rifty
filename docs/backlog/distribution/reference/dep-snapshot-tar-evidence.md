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
