---
area: playground
status: draft
title: Spike monaco-vscode-api as the VS Code service layer over the rifty playground
created: 2026-06-25
why: The playground already hand-rolls several VS Code-shaped editor/workbench seams; verify whether monaco-vscode-api can replace shallow glue without weakening rifty's VFS/TS/runtime fidelity.
user_story: As a rifty maintainer, I want to know which editor/workbench glue can be deleted in favour of VS Code-compatible services, but today the answer is implicit and the risk of duplicating the TS/file/runtime truth is high.
sources: [ADR-0075, ADR-0166, docs/public/compat/ts-language-service.md, monaco-vscode-api README/wiki, VS Code Web Extensions guide]
code: [apps/playground/src/components/EditorHost.tsx, apps/playground/src/components/CommandPalette.tsx, apps/playground/src/components/FileExplorer.tsx, apps/playground/src/glue/ts-ls-monaco-providers.ts, apps/playground/src/glue/realVite.ts]
---

## Context

The playground has a VS Code-style shell already: Solid layout, Monaco editor tabs,
xterm terminal, Problems, Explorer, preview, and a workspace owner. Some of that is
product-specific and should stay local, but some seams look like hand-rolled VS Code
infrastructure:

- editor settings/theme/keybinding/command plumbing;
- standalone Monaco model lifecycle plus path maps;
- snapshot-backed Explorer instead of a URI/file-service model;
- custom LSP-to-Monaco provider glue over the rifty TS language service.

`monaco-vscode-api` may provide the deeper module here: VS Code service overrides
for configuration, themes, keybindings, quick access, files, search, model
references, and web-extension APIs. The spike must not treat this as a replacement
for rifty core. The authoritative runtime remains the workspace owner, VFS/OPFS,
pty/process model, preview routing, and `@riftydev/ts-language-service`.

High-risk guardrails:

- Do not enable a second JS/TS semantic engine. ADR-0166 keeps rifty's real
  `ts.LanguageService` over VFS as the single JS/TS truth unless a later ADR
  proves a replacement against parity.
- Do not expose `SnapshotFs` as writable. File writes must route to the owner.
- Do not include a generic extension host by default. Web extensions are a later,
  allowlist-only phase.
- Do not add `monaco-vscode-api` as a production dependency without an ADR: this is
  a new external dependency and changes the editor/service architecture.

## Options or Next

1. **Service-only playground spike.** Add `monaco-vscode-api` behind an isolated
   playground experiment and initialize only low-risk service overrides:
   configuration/settings, themes, keybindings, and quick access. Keep current
   `EditorHost`, rifty TS providers, and file flow intact. Success = visible
   command palette/settings/theme value with no TS/file/runtime behaviour change.

2. **URI contract.** Decide and test the file identity model before moving data:
   likely `rifty:/scratch/...` and `rifty:/projects/<id>/...` rather than raw VFS
   paths. Define conversions between VFS absolute paths, Monaco/VS Code `Uri`, and
   rifty TS-LS LSP-shaped locations. Project switch (ADR-0165) must be represented
   as closing/replacing the workspace root, not mutating a live root pointer.

3. **Owner-routed file service.** Build a file-service adapter over the workspace
   owner: `stat`, `readDirectory`, `readFile`, `writeFile`, `createDirectory`,
   `delete`, `rename`, `copy`, and `watch`. Large `node_modules` reads stay lazy
   and capped; binary files remain honestly non-editable unless classified. This
   phase should reuse or supersede the existing snapshot/read/write ports, not add
   a second source of truth.

4. **File-backed models.** Replace standalone `monaco.editor.createModel` paths
   with VS Code model references backed by the file service. Target deletions:
   manual path-to-model maps, ad-hoc dirty/save/dispose handling, and parts of the
   custom read-only fallback path. Keep the program tab invariant until tests prove
   the replacement preserves preset/HMR behaviour.

5. **Search / quick open.** Once the file service is real, try VS Code workspace
   search and quick-open over the active root. Success = search respects excludes,
   lazy `node_modules`, large-file caps, and project switch teardown.

6. **Language-provider migration only if it deletes glue.** Keep
   `@riftydev/ts-language-service` as the engine. Explore whether VS Code provider
   APIs or `vscode-languageclient` can replace `ts-ls-monaco-providers.ts` without
   introducing a second TypeScript worker/server. Success = same compat rows and
   parity coverage, less adapter code.

7. **Extension host last.** If the above proves useful, consider a web-extension
   host behind an allowlist. Unsupported VS Code APIs must throw loudly; no Node
   `fs`, native language servers, or unbounded network access. Open VSX/VSIX
   licensing and bundle-size review are part of the gate.

Spike output should be concrete:

- what code can be deleted;
- what dependency and bundle cost was added;
- what behaviours changed, with tests;
- which gaps require ADRs before implementation.

## Reversibility

REVERSIBLE as a backlog/spike item. Implementing the dependency, file-service
contract, model lifecycle change, or extension host is IRREVERSIBLE under
`docs/process/decision-workflow.md` and needs an ADR before merge.
