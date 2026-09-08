# ADR 0403: Retain downloadable orphan Scratch beside a fresh Scratch

Status: Accepted
Date: 2026-09
Refines: ADR-0279, ADR-0401

> TL;DR: Unjournaled Scratch bytes are copied into a catalog-pointed retain
> tree in the same staged catalog transaction that opens fresh Scratch;
> hosts enumerate/download via public catalog methods; a failed preserve
> restores the only copy and does not claim success.

## Context

Goal self-hosted-snapshot-workbench I6. A real OPFS tree at
`/.rifty/workbench/v1/projects/scratch` with no catalog Scratch row and no
owning journal blocks `createScratch` (`Catalog mutation target already
exists: scratch`). User: retain those bytes for public download and open
fresh Scratch; do not adopt the tree as a runnable project; do not delete
it. ADR-0279 remains the mutation owner. ADR-0401 bounds the same VFS
root when a storage namespace is selected.

## Decision

**Detect** (after existing startup journal recovery): `catalog.scratch` is
null, `/.rifty/workbench/v1/projects/scratch` is a directory, and no
`transaction.json` remains. That tree is an unjournaled orphan. A
catalog-owned Scratch or a still-owned journal is not this case.

**One existing transaction.** `createScratch` that detects an orphan runs
one compact staged catalog transaction (ADR-0279) with two mutations:

1. `retain-orphan` — id is a clone-safe unique token `orphan-scratch-<unique>`;
2. `create` — fresh Scratch from the supplied definition.

Journal records roles and ids only. Bytes stay in derived VFS stages.
`create`'s "target must not exist" precondition is waived for `scratch`
when the same transaction retains that directory; the retain owns the
existing tree. Implementation lives in a new module so
`playground-project-authority.ts` does not grow.

**Commit pointer.** Optional catalog key `retainedOrphans`:
`{ id, retainedAt }[]`. Absent on read means `[]`. A directory under the
retain root without a catalog row is not enumerated. A catalog row
without its tree is a loud read error, not an empty download.

**Retain root.** Ordinary project-tree files (including build output and
`node_modules`) copy to `/.rifty/workbench/v1/retained-orphans/<id>/`.
Public paths are tree-relative POSIX (`user.txt`, `src/note.txt`). Reject
empty, `.`, `..`, absolute, `//`, and `\` with `TypeError` naming the
path. Scratch authority metadata (`definition.json`) and install-stamp
claims are not copied as restored trust and are not rebound onto the
fresh Scratch. Fresh Scratch is the starter definition tree only.

**Public API** on `PlaygroundProjectCatalog` (page owner protocol carries
the same clone-safe operations). `snapshot()` is unchanged.

```ts
listRetainedOrphans(): Promise<readonly { id: string; retainedAt: string }[]>
listRetainedOrphanEntries(id: string): Promise<readonly { path: string }[]>
readRetainedOrphanFile(id: string, path: string): Promise<Uint8Array>
```

Reads enqueue on the catalog FIFO and do not delete or mutate retained
bytes. A failed read stays retryable. Unknown id or path throws; saved
bytes remain. No automatic eviction.

**Failed preserve.** Pre-commit persist/permission failure rejects with
the quota/permission error, restores exact pre-state (orphan tree still
at `projects/scratch`, catalog unchanged, no retained row), and does not
return a Scratch snapshot.

**Namespace.** Retain trees live on the bound VFS `/` (ADR-0401). A
selected `storage.namespace` keeps retained bytes inside that directory.

Candidates: adopt-as-project (killed: user rejected). Delete orphan
(killed: user rejected). Second journal or sidecar index (killed:
Class-kill / ADR-0279). Directory listing as commit proof (killed: a torn
copy would enumerate). `snapshot.retainedOrphans` (killed: breaks the
existing snapshot exact-key contract; methods suffice). Two sequential
transactions (killed: a committed retain plus failed create claims
preserve without a fresh Scratch).

## Consequences

- Boot `createScratch` can open a starter Scratch when only an unjournaled
  leftover tree is present.
- Hosts download exact orphan bytes without running that tree.
- Catalog schema admits an optional `retainedOrphans` key.
- Page catalog gains three query methods and matching owner commands.
- Failed preserve stays a loud pre-state restore, same owner as Save.
