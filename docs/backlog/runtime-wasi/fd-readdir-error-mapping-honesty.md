---
area: runtime-wasi
status: active
title: fd_readdir flattens a throwing readdirSync to E_BADF instead of errToWasiErrno
created: 2026-06-13
why: A valid dir fd whose backend readdirSync throws a non-BADF error (EACCES on OPFS permission revocation, ENOTDIR/ENOENT on a concurrent rmSync race) returns a misleading 'bad file number' to the guest — the same lie-to-guest class ADR-0049 D4 fixed for the file-fd case.
sources: [ADR-0049, CLAUDE.md no-silent-stubs]
code: [packages/runtime-wasi/src/syscalls/fd.ts, packages/runtime-wasi/src/syscalls/path.ts, packages/runtime-wasi/src/syscalls/shared.ts]
---

## Context

Every VFS-touching catch in path.ts routes through errToWasiErrno (ENOENT/EACCES/ENOTDIR/EISDIR/EPERM/EINVAL/ENOTEMPTY -> honest preview1 errnos). fd_readdir at fd.ts:343-347 is the lone exception: its readdirSync catch hard-codes E_BADF. ADR-0049 D4 scoped the honesty fix to the type-check branch (non-dir fd -> E_NOTDIR; 'Unknown fd still -> E_BADF'); the throwing-enumeration branch was never reconsidered. Low blast radius (esbuild happy path unaffected since MemoryFsSync readdir on a valid opened dir doesn't throw). No regression test covers a throwing readdir (fd-stat-readdir.test.ts covers unknown-fd E_BADF and file-fd E_NOTDIR only).

## Options or Next

Replace `catch { return E_BADF; }` at fd.ts:345-347 with `catch (err) { return errToWasiErrno(err); }` (already imported in path.ts). Add a regression test: open a valid dir fd, stub the mirror's readdirSync to throw an EACCES-coded error, assert rc maps to E_ACCES (not E_BADF), failing before the fix. A genuine EBADF-coded throw still maps to E_BADF via the default, preserving the existing contract.

## Reversibility

REVERSIBLE — backlog item; behavior-preserving on the happy path, one-line fix + regression test, aligns with ADR-0049 D4 rather than overturning it.
