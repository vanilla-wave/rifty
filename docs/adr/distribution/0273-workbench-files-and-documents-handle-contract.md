# ADR 0273: Workbench files and documents handle contract

Status: Accepted
Date: 2026-07

> TL;DR: Workbench exposes byte-exact conditional file CRUD, lazy reads, a
> truthful source-tree subscription, and explicitly saved/discarded documents;
> owner paths, epochs, revisions, and protocols stay private.

## Context

ADR-0263 fixes `ProjectSession.files` and `.documents` but not their exact
public methods. The ready contract requires owner CAS, reflected revision, and
durability before host writes resolve. The Playground also needs live source
tree metadata, while recursively publishing `.git` and `node_modules` after
every package mutation is unbounded. Exact public shape is package API.

## Decision

`ProjectSession.files` exposes:

- `readFile(path)` returning copied bytes plus opaque version;
- `readdir(path)` returning exact immediate-child metadata plus versions;
- `writeFile(path, Uint8Array, { expectedVersion })`;
- `mkdir(path, { expectedVersion: null })`;
- `rename(source, target, { expectedSourceVersion, expectedTargetVersion })`;
- `remove(path, { expectedVersion, recursive? })`;
- `snapshot()` and `subscribe(listener)` for the current source-tree view.

Writes accept bytes only. Text convenience belongs at the caller/document
layer. Every mutation is conditional; `null` means absent. Write/mkdir/rename
return the resulting project-rooted path and non-null version. Remove resolves
without a fabricated version. Success means exact owner ACK, a reflected
snapshot at or beyond that revision, then applicable durability.

The subscribed snapshot contains project-rooted metadata and opaque versions.
Its exact shape is `{ excludedDirectoryNames, entries }`; entries carry
project-rooted path, kind, size, and version, never bytes. It declares the fixed
excluded directory names (`node_modules`, `.git`, `.vite`, `dist`); `readdir`
remains the exact lazy path for those trees. A new subscriber receives the
current snapshot synchronously. Subscriber failures cannot suppress siblings.
No owner root, epoch, tree revision, token, frame, or transport is public.

Paths are absolute within the project. Root mutation, empty/dot segments,
traversal, NUL, and `/.rifty` reject before transport. Physical owner paths are
mapped inside the session and never appear in public results or errors.

`ProjectSession.documents.open(path)` atomically captures file bytes and
version. A document exposes `snapshot`, `replace(string | Uint8Array)`, `save`,
and `close({ dirty?: 'save' | 'discard' })`. Save uses the captured/last-save
version; edits during save remain dirty. Dirty close without an explicit choice
rejects. Rename/remove/reset invalidates affected open documents in owner
order. Conflicts preserve local bytes, exact remote bytes/entry, and both
versions without retry/rebase/last-writer-wins.

`FileConflictError.actualEntry` is exact project-rooted metadata
`{ path, kind, size, version } | null`; file bytes live only in the copied
`actualBytes`. Other read/mutation/document-open/save failures become public
`ProjectFileOperationError`. Its exact fields are `operation` (`readFile`,
`readdir`, `writeFile`, `mkdir`, `rename`, `remove`, `openDocument`, or
`saveDocument`), logical source `path`, `targetPath` only for rename, and
`mutationOutcome: 'applied' | 'unknown' | null`. `null` is a read; applied means
an ACK proved mutation before a later failure. It never exposes an internal
cause, ACK, owner identity/revision, physical path, or operation id.

Successful rename/remove invalidates affected documents on the validated owner
ACK, before reflection and durability, preserving owner order against saves. A
failed CAS never invalidates. If ACK-level invalidation fails after apply, the
mutation reports an applied failure; it never resolves falsely.

Documents-controller close is an all-or-nothing preflight. Dirty or saving
documents reject without fencing the controller or closing clean siblings.
Already admitted saves settle unchanged; after the handles are clean, retrying
close fences new opens and closes every document. Close waits for already
admitted opens; a read completing after the fence is closed internally and its
open rejects, so successful close never leaves a live document handle.

An applied document-save failure advances the document's CAS base to the
version proven by its ACK while leaving the bytes dirty. The next save uses
that version. An unknown outcome keeps the prior version; a next save uses that
base and therefore conflicts if the earlier write did apply. It never guesses a
new version.

`FileConflictError` is public and project-rooted. Document lifecycle errors are
Workbench-owned public errors. Internal glue errors, invalidation methods, and
owner evidence are not exported.

## Consequences

- Hosts can build a live file tree without receiving raw owner authority.
- Large derived trees use explicit lazy reads instead of hidden truncation.
- The package commits to these root methods and snapshot exclusions.
- Companion TS/SCM/archive remain separate semantic handles over the same owner.
