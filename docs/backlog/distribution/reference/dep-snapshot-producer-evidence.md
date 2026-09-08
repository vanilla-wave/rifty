# Dependency snapshot producer proof

## Baseline / RED — 2026-09-08

Branch `self-hosted-snapshot-workbench` after PR #316 codec + ADR-0389.
Node v24; Vitest 2.1.9.

`pnpm exec vitest run packages/workbench/src/dep-snapshot-producer.test.ts`

6 failed / 0 passed:

- sealed `./dep-snapshot` export is absent from `@riftydev/workbench`
- `produceDepSnapshot` is undefined on the existing glue module
- lock-pin, gzip/HTTP restore, lifecycle/corrupt-lock, and abort cases
  fail for the missing producer, not import/typecheck

Existing codec suite remains green:

`pnpm exec vitest run packages/workbench/src/glue/dep-snapshot-tar.test.ts`
22 passed.

No destination snapshot is emitted today from caller manifest+lock through a
published Workbench entry. Fake registry and Memory VFS are test doubles for
the network boundary; install() is the real owner.
