---
area: playground
status: active
title: Read-only VS Code FileSystemProvider over the rifty owner snapshot
created: 2026-06-25
why: Before replacing the playground Explorer, prove that VS Code file services can browse rifty files without creating a second source of truth.
user_story: As a developer using the playground, I want VS Code-backed file browsing to show the real owner workspace, but today the only safe view is the custom read-only SnapshotFs explorer.
sources: [docs/backlog/playground/monaco-vscode-api-workbench-services-spike.md, docs/backlog/playground/vscode-rifty-uri-contract.md, ADR-0148, ADR-0165, VS Code FileSystemProvider API]
code: [apps/playground/src/components/FileExplorer.tsx, apps/playground/src/glue/snapshot-fs.ts, apps/playground/src/glue/vfs-snapshot-port.ts, apps/playground/src/glue/node-modules-port.ts, apps/playground/src/glue/realVite.ts]
---

## Context

The current playground Explorer is a read-only view over the owner snapshot. That
is honest: the owner is the source of truth and `SnapshotFs` must not become a
writable fake. A first VS Code file-provider spike should preserve that honesty
by exposing only read methods:

- `stat`;
- `readDirectory`;
- `readFile`;
- `watch` only if it can report real/coarse owner snapshot changes; otherwise
  leave it absent or explicitly limited by the provider contract.

This spike should not implement create, write, rename, delete, or copy. Those
belong to the owner-routed file-service follow-up once the read-only path proves
useful.

## Options or Next

1. Implement a playground-local read-only provider for the URI contract from
   `vscode-rifty-uri-contract`.
2. Back normal project files with the existing owner snapshot.
3. Keep `node_modules` lazy:
   - directory reads may use the existing read port/cache;
   - large file reads stay capped;
   - no full-tree eager enumeration.
4. Return precise errors for missing paths, unsupported schemes, binary/too-large
   reads, and paths outside the active root.
5. Verify that VS Code services can browse/open files without enabling writes.
6. Capture what code could be deleted from `FileExplorer` only after the provider
   proves stable.

## Reversibility

REVERSIBLE as a read-only spike. A write-capable file provider changes the
workspace mutation contract and should be recorded separately, likely with an ADR
if it replaces current owner write flows.
