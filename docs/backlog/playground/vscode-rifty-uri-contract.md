---
area: playground
status: draft
title: VS Code URI contract for rifty workspace files
created: 2026-06-25
why: VS Code services require URI-backed file identity, while the playground currently passes raw VFS paths through Monaco and TS-LS glue.
user_story: As a maintainer integrating VS Code services, I want one documented mapping between rifty VFS paths and VS Code URIs, but today every layer can invent its own path conversion and drift.
sources: [docs/backlog/playground/monaco-vscode-api-workbench-services-spike.md, docs/backlog/playground/monaco-vscode-api-service-only-spike.md, ADR-0165, ADR-0166, docs/public/compat/ts-language-service.md]
code: [apps/playground/src/components/EditorHost.tsx, apps/playground/src/glue/ts-ls-monaco-providers.ts, packages/ts-language-service/src/lsp-types.ts, apps/playground/src/glue/project-index.ts]
---

## Context

The current editor and TS language-service bridge use absolute VFS paths such as
`/scratch/src/main.ts` or `/projects/<id>/src/main.ts`. VS Code services expect
resources to be `Uri` values. If the file provider, editor models, search, TS-LS
locations, and project switch code each choose their own conversion, path bugs
will spread across the playground.

This item decides the file identity seam before a VS Code file provider or
file-backed models exist. The likely shape is a custom scheme such as:

- `rifty:/scratch/src/main.ts`
- `rifty:/projects/<id>/src/main.ts`

Project switch must follow ADR-0165: close/replace the active workspace root and
respawn/rebind owner bridges. It must not pretend the owner can live-mutate its
root.

## Options or Next

1. Pick the scheme and root shape for active project files:
   - custom `rifty:` scheme;
   - or `file://` over synthetic paths if VS Code compatibility requires it.
2. Define pure conversion helpers:
   - VFS absolute path -> VS Code `Uri`;
   - VS Code `Uri` -> VFS absolute path;
   - TS-LS raw location path -> editor `Uri`;
   - editor `Uri` -> TS-LS raw path.
3. Define what is not addressable:
   - synthetic `/ts-lib/` files;
   - too-large `node_modules` files;
   - binary/non-editable files.
4. Add unit tests for root switching, path escaping, spaces/special characters,
   node_modules paths, and unknown schemes.
5. Record whether TS-LS wire types stay raw-path-based for now or gain URI-shaped
   fields behind a later ADR.

## Reversibility

REVERSIBLE as a backlog item while no provider consumes it. Once the URI contract
is consumed by VS Code file services, model references, search, or public APIs, it
becomes IRREVERSIBLE and needs an ADR.
