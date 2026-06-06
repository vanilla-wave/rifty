# ADR 0029: `utimes` on the `FsSync` interface

Status: Accepted (promoted from Q-2026-05-25-touch-utimes)
Date: 2026-05

## Context

`touch` in `packages/shell/src/builtins.ts` updates `mtime` via the active sync mirror. When Q-2026-05-25-touch-utimes was logged, `touch` was the only caller, so the cheap path was backend-sniffing — `if (syncMirror() instanceof MemoryFsSync) {...}`, throwing `NotImplementedError` otherwise. That required importing `MemoryFsSync` from `@riftydev/vfs/internal`, violating the "public API only via `src/index.ts`" hard rule (CLAUDE.md), and would block OPFS as the default mirror (`touch` would throw inside a Worker).

A second caller is now imminent: `node:fs.utimesSync` from `packages/runtime-js/src/builtins/fs.ts`. The Q entry flagged exactly this trigger: "Promote to A when a second caller appears."

## Decision

Add `utimes(path: string, atimeMs: number, mtimeMs: number): void` to the `FsSync` interface (`packages/vfs/src/fs-sync.ts`). Backends:

- **`MemoryFsSync`** — writes through to `MemoryBackend.utimes`, mutating `node.atime` / `node.mtime`. Throws `VfsError('ENOENT')` for unknown paths.
- **`OpfsFsSync`** — keeps an in-memory side-table (`Map<path, { atime, mtime }>`) populated by `utimes`; `statSync` prefers it over the default `0`. The OPFS sync API (`FileSystemSyncAccessHandle`) exposes no mtime mutation primitive, so a side-table is the only correct sync-surface option. Cross-reload persistence is a follow-up (needs an OPFS metadata file); the side-table covers today's live-session uses (`touch`, `fs.utimesSync`).

Consumers stop backend-sniffing: `packages/shell/src/builtins.ts` drops the `@riftydev/vfs/internal` import and calls `syncMirror().utimes(path, now, now)` directly. `packages/runtime-js/src/builtins/fs.ts` gains a thin `utimesSync(path, atime, mtime)` that converts Node's seconds-or-Date inputs to ms and forwards to the sync mirror.

## Consequences

- `FsSync` gains one method, paid once across all backends. New backends must implement `utimes` (irreversible per Reversibility checklist point 1 — public API between packages).
- `packages/shell/src/builtins.ts` is back within layering rules (no `@riftydev/vfs/internal` imports outside runtime-js' fs-sync-mirror seam).
- `node:fs.utimesSync` + `fs.promises.utimes` now exist in `runtime-js`, closing a `node:fs` compat gap.
- Negative: `OpfsFsSync` atime/mtime are not durable across page reloads (in-memory side-table). A user who `touch`es, reloads, and expects mtime to persist will be surprised. Mitigation: documented in `OpfsFsSync` JSDoc + follow-up below; not blocking M10/M11.
- Negative: `OpfsFsSync` now keeps two parallel sparse maps (`index`, `times`). Acceptable; fold into one entry struct if a third side-table appears.
- Follow-up: persist atime/mtime in an OPFS metadata file so the side-table survives reloads. Defer until a real complaint or a cross-reload parity test fails.

## Acceptance criteria

- [x] `FsSync.utimes(path, atimeMs, mtimeMs)` declared in `packages/vfs/src/fs-sync.ts`.
- [x] `MemoryFsSync.utimes` writes through `MemoryBackend.utimes`; updates `atime`/`mtime` independently; throws `VfsError('ENOENT')` for unknown paths.
- [x] `OpfsFsSync.utimes` records into a side-table; `statSync` reflects it; throws `VfsError('ENOENT')` for unknown paths.
- [x] `runtime-js` `utimesSync` and `fs.promises.utimes` route through `syncMirror().utimes`.
- [x] `packages/shell/src/builtins.ts` no longer imports from `@riftydev/vfs/internal`; `touch` calls `syncMirror().utimes` directly.
- [x] Parity case `tools/node-parity-runner/cases/fs/utimes-basic.case.ts` passes (Node vs rifty agree on `statSync('x').mtimeMs` after `utimesSync('x', 1, 2)`).
- [x] OPEN_QUESTIONS.md moves Q-2026-05-25-touch-utimes to "Promoted" with this ADR as resolution.
- [x] No `TODO(ADR): Q-2026-05-25-touch-utimes` markers remain (`pnpm todo:adr`).
