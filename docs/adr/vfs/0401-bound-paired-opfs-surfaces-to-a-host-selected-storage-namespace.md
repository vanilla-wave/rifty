# ADR 0401: Bound paired OPFS surfaces to a host-selected storage namespace

Status: Accepted
Date: 2026-09
Refines: ADR-0072

> TL;DR: Optional `storage.namespace` is a clone-safe relative OPFS path;
> omitted keeps today's origin root; a selected path is the one handle both
> paired surfaces bind, empty on first create and preserved on reopen.

## Context

Goal self-hosted-snapshot-workbench I4. `installOpfsFs()` and both
`OpfsVfs.init` / `OpfsFsSync.init` call `navigator.storage.getDirectory()`
and index/preload every origin file. Embedders need an isolated root so
unrelated host files stay outside rifty's normal preload and writes.
User: new root starts empty; former setting still exposes former projects;
no automatic migration. Not a hostile-code security boundary; not multiple
concurrent owners. ADR-0072 still owns write-through pairing.

## Decision

Public Workbench option (clone-safe initialize field):

```ts
storage: {
  persistence: 'required' | 'preferred' | 'ephemeral';
  namespace?: string;
}
```

Omitted `namespace` is today's origin root. Present value is a relative
OPFS path: one or more `/`-separated segments, each `/^[A-Za-z0-9._-]+$/`
and neither `.` nor `..`. Reject empty string, leading/trailing `/`, `//`,
`\`, `.`, `..`, ancestor walks, and any other spelling, with `TypeError`
naming `storage.namespace`, before any `getDirectoryHandle`.

One parse + resolve helper is the path authority. `installOpfsFs` takes
optional `{ namespace }`, resolves the origin handle, walks `create: true`
only after parse succeeds, and passes **that same handle** to both
`OpfsVfs` and `OpfsFsSync`. Surfaces do not each call `getDirectory()`.

A never-used path is an empty directory (no copy from origin or another
namespace). Reopening the same path keeps its files. `ephemeral` admits
the field but does not open OPFS. Existing origin lease is unchanged.

Invalid admission fails before owner start. Failed setup/reopen of one
namespace does not mutate another namespace's bytes.

Candidates: clone-safe string path (selected; smallest initialize fit).
`FileSystemDirectoryHandle` in options (killed: owner initialize is
inspected JSON, not a transferable handle). Virtual prefix after origin
preload (killed: still indexes/preloads unrelated origin files). Automatic
migration into the new path (killed: goal rejected route).

## Consequences

Embedders isolate Workbench caches, proof files, and recovery under a
host-selected directory. Default callers keep origin-root behavior.
Playground `initBackend()` stays origin (omitted namespace).
