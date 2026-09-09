# ADR 0407: Retain orphan Scratch bytes in catalog transactions

Status: Accepted
Date: 2026-09

## Context

Goal I6 selects retained download plus fresh Scratch, without adopting an
unjournaled tree as a runnable project. Existing createScratch refuses its
occupied target. ADR-0279 already owns compact journals, copying, catalog commit
and recovery; ADR-0406 fixes the demonstrated cold-cache byte fabrication.
Research and native evidence: docs/backlog/playground/reference/orphan-scratch-recovery-pickup.md.

## Decision

1. Detect only an existing Scratch tree with no catalog Scratch reference,
   after normal catalog/legacy journal validation and recovery. Malformed or
   unresolved journals/layouts remain loud and preserved. No named-project
   scanning, orphan adoption or replacement of a journal-owned source.
2. Add finite retain-scratch role to the existing catalog transaction owner.
   Copy ordinary Scratch payload file-by-file to a derived retained root while
   its original stays intact. Publish a stable opaque retention id through the
   same durable catalog pointer. Only post-commit cleanup removes the original.
   Recover this cleanup before another orphan decision, preventing duplicates.
   Then run ordinary createScratch separately; a failed fresh creation leaves
   committed retained bytes/record available. No combined atomicity promise.
3. Retained roots live under the selected mount at
   /.rifty/workbench/playground/retained-scratch/<id>/tree, outside project and
   transaction-stage GC. Derive paths from validated ids; journal stores finite
   roles/ids/catalog metadata, never source inventories or bytes. Existing
   catalogs omit the new optional retainedScratch collection. Unknown retained
   roots are never deleted merely because no catalog record names them.
4. Add catalog.listRetainedScratch(): Promise<readonly PlaygroundRetainedScratch[]>
   and catalog.exportRetainedScratch(id): Promise<string>. A retained record
   contains only readonly id. Use existing owner lifetime, catalog FIFO and
   transport correlation; no live ProjectSession is required. Unknown ids,
   closed owner, read failure and export overflow reject without consuming data.
   No raw paths/handles, delete, import, adopt or force-trust API.
5. Download is a distinct bounded JSON envelope: format:'rifty-scratch-recovery',
   version:1, root:'/', directories:string[], files:{path,encoding:'base64',content}[].
   Paths are literal project-relative POSIX names; slash separates components,
   backslash remains a filename character, never a host separator or URL escape.
   Preserve ordinary empty directories, binary/source, node_modules, dist, Git,
   .vite and nested .rifty. Exclude only root-private .rifty and existing
   isInstallStampPath claim namespaces, including claim-shaped directories.
   No fabricated manifest/identity or restored install trust. Existing editable
   archive ingress remains unchanged and rejects this distinct envelope.
6. Reuse existing numeric archive bounds:16MiB/file,32MiB total decoded,
   48Mi UTF-16 JSON units,10,000files,20,000traversed entries,256path segments.
   Actual representative produced Vite payload:267files/336entries,23,601,962B,
   largest13,918,738B,depth7; existing generic JSON encoding31,493,921units.
   New-envelope allocation is verified by acceptance. These bound export allocation;
   retention remains file-by-file and
   quota-limited, independent of building one export string. No larger-project
   guarantee, silent truncation, eviction or new public byte-limit option.

## Alternatives and existing owners

- Existing catalog role/pointer and separated retained root: selected; reuses
  established copy-before-pointer and post-commit cleanup/recovery authorities.
- Second retention journal/registry: duplicate commit/recovery authority.
- Rename-only shortcut: native OPFS has no atomic rename; existing async rename
  copies then removes and does not by itself publish durable retained ownership.
- Treat orphan as a project or clear it: contradicts the user's recovery choice.
- Existing editable export unchanged: drops dependency/build files. Generic
  workspace export unchanged: lacks public bounds/root-private redaction.
- Dependency snapshot tar with invented identity: dishonest. Extracting a new
  generic tar encoder is unnecessary for the selected recovery download.

## Proof and retained authorities

Real selected OPFS namespace: preserve → fresh Scratch → list/export → reopen;
ordinary byte/path equality, original namespace/siblings untouched. Native kills
around retention copy, pointer, cleanup and subsequent fresh creation establish
before/after custody. Failed preservation keeps the original; post-commit fresh
failure keeps the retained result. ADR-0279/0358 remain transaction/drain owners;
ADR-0261/0329 remain claim authorities; ADR-0402 bounds storage. I1's standard
archive promise applies to dependency snapshots, not this recovery envelope.
