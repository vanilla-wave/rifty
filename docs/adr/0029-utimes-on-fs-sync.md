# ADR 0029: `utimes` on the `FsSync` interface

Status: Accepted (promoted from Q-2026-05-25-touch-utimes)
Date: 2026-05

## Context

`packages/shell/src/builtins.ts` `touch` updates `mtime` on an existing file
through the active sync mirror. When Q-2026-05-25-touch-utimes was logged
`touch` was the sole caller, so the cheap escape hatch was to backend-sniff:
`if (syncMirror() instanceof MemoryFsSync) { fs.backend.resolve(path).mtime = …
}`, throwing `NotImplementedError` for any other backend. That sniffing
required `packages/shell/src/builtins.ts` to import `MemoryFsSync` from
`@riftydev/vfs/internal`, which violates the "public API only via `src/index.ts`"
hard rule (CLAUDE.md), and would also block OPFS becoming the default sync
mirror because `touch` would loudly throw inside a Worker.

A second consumer is now imminent: `node:fs.utimesSync` from
`packages/runtime-js/src/builtins/fs.ts`. With two callers the escape hatch
loses its "only one site" justification and the cost of backend-sniffing
grows nonlinearly. Q-2026-05-25-touch-utimes explicitly flagged this
trigger: "Promote to A when a second caller appears."

## Decision

Add `utimes(path: string, atimeMs: number, mtimeMs: number): void` to the
`FsSync` interface (`packages/vfs/src/fs-sync.ts`). Backends:

- **`MemoryFsSync`** — writes through to `MemoryBackend.utimes`, which mutates
  `node.atime` / `node.mtime` on the resolved file/dir node. Throws
  `VfsError('ENOENT')` for unknown paths.
- **`OpfsFsSync`** — keeps an in-memory side-table
  (`Map<path, { atime, mtime }>`) populated by `utimes`. `statSync` prefers
  the side-table value over the default `0`. The OPFS sync API
  (`FileSystemSyncAccessHandle`) exposes no mtime mutation primitive, so a
  side-table is the only correct option for the sync surface. Persistence
  of atime/mtime across page reloads is a follow-up (would require an OPFS
  metadata file); the side-table is sufficient for the live-session use
  cases that exist today (`touch`, `fs.utimesSync`).

Consumers stop backend-sniffing. `packages/shell/src/builtins.ts` drops the
`@riftydev/vfs/internal` import and calls `syncMirror().utimes(path, now, now)`
directly. `packages/runtime-js/src/builtins/fs.ts` gains a thin
`utimesSync(path, atime, mtime)` that converts Node's seconds-or-Date inputs
to ms and forwards to the sync mirror.

## Consequences

- The `FsSync` interface gains one method, paid for once across all current
  and future backends. Adding a new backend now includes implementing
  `utimes` (irreversible per Reversibility checklist point 1 — touches the
  public API between packages).
- `packages/shell/src/builtins.ts` is back inside the layering rules
  (no `@riftydev/vfs/internal` imports outside runtime-js' fs-sync-mirror seam).
- `node:fs.utimesSync` and its `fs.promises.utimes` wrapper now exist in
  `runtime-js`, closing one of the small gaps in `node:fs` compat coverage.
- Negative: `OpfsFsSync`'s atime/mtime are not durable across page reloads
  because they live in an in-memory side-table. If a user `touch`es a file,
  reloads the page, and then expects the mtime to persist, they will be
  surprised. Mitigation: documented in `OpfsFsSync` JSDoc and listed as a
  follow-up below; persistence requires a metadata file alongside OPFS
  entries and is not blocking M10/M11.
- Negative: `OpfsFsSync` now keeps two parallel sparse maps (`index`,
  `times`) instead of one. Acceptable for the scope today; if a third
  side-table appears, fold them into a single entry struct.
- Follow-up: persist atime/mtime in an OPFS metadata file so the
  side-table survives page reloads. Defer until a real user complaint or a
  parity test starts failing across reloads.

## Acceptance criteria

- [x] `FsSync.utimes(path, atimeMs, mtimeMs)` declared in
      `packages/vfs/src/fs-sync.ts`.
- [x] `MemoryFsSync.utimes` writes through `MemoryBackend.utimes`; updates
      `atime` and `mtime` independently; throws `VfsError('ENOENT')` for
      unknown paths.
- [x] `OpfsFsSync.utimes` records into a side-table; `statSync` reflects it;
      throws `VfsError('ENOENT')` for unknown paths.
- [x] `runtime-js` `utimesSync` and `fs.promises.utimes` route through
      `syncMirror().utimes`.
- [x] `packages/shell/src/builtins.ts` no longer imports from
      `@riftydev/vfs/internal`; `touch` calls `syncMirror().utimes` directly.
- [x] Parity case `tools/node-parity-runner/cases/fs/utimes-basic.case.ts`
      passes (Node vs rifty agree on `statSync('x').mtimeMs` after
      `utimesSync('x', 1, 2)`).
- [x] OPEN_QUESTIONS.md moves Q-2026-05-25-touch-utimes to the "Promoted"
      section with this ADR as the resolution.
- [x] No `TODO(ADR): Q-2026-05-25-touch-utimes` markers remain in the
      workspace (`pnpm todo:adr`).
