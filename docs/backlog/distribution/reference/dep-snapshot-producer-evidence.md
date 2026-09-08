# Dependency snapshot producer proof

## Baseline / RED — 2026-09-08

Branch `self-hosted-snapshot-workbench` after PR #316 codec + ADR-0389.
Node v24; Vitest 2.1.9.

`pnpm exec vitest run packages/workbench/src/dep-snapshot-producer.test.ts`

First RED used a foreign `npm-client` `_test-fixtures` import and a wrong
`createMemoryFs` destructure (`{ fs }`). Those were authoring defects
(Contract+RED review, TS6059/TS2339). Fixtures are now local; gzip/HTTP
case uses `{ fsSync }`. `tsc -p packages/workbench/tsconfig.json --noEmit`
reports no errors in this file.

Rerun: 6 failed / 0 passed:

- sealed `./dep-snapshot` export is absent from `@riftydev/workbench`
- `produceDepSnapshot` is undefined on the existing glue module
- lock-pin, gzip/HTTP restore, lifecycle/corrupt-lock/file-spec, and abort
  cases fail for the missing producer, not import/typecheck

Existing codec suite remains green:

`pnpm exec vitest run packages/workbench/src/glue/dep-snapshot-tar.test.ts`
22 passed.

No destination snapshot is emitted today from caller manifest+lock through a
published Workbench entry. Fake registry and Memory VFS are test doubles for
the network boundary; install() is the real owner.
