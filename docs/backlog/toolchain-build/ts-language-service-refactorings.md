---
area: toolchain-build
status: shipped
title: TS language service — refactorings (getApplicableRefactors / getEditsForRefactor)
created: 2026-06-22
why: refactor actions and edits are now exposed from the real TS service with metadata preserved instead of silent no-op stubs
user_story: As a rifty playground/agent user, I can request VSCode-style refactors (extract function/constant, move to new file, convert imports, infer return type, …) over my real project + tsconfig and receive the real TS edit/metadata
sources: [ADR-0166]
code: [packages/ts-language-service/src/service.ts, packages/ts-language-service/src/worker/protocol.ts, apps/playground/src/glue/ts-ls-monaco-providers.ts]
---

## Context

Landed 2026-06-22: `getApplicableRefactors` /
`getEditsForRefactor` are exposed through the engine, worker protocol, page
client, and Monaco code actions. Non-interactive refactors carry real
`WorkspaceEdit`s; interactive variants surface metadata instead of a guessed
default.

This shipped item is retained as the delivery record. Refactor actions expose the
real TS refactor/action ids, applicability metadata, text edits, command metadata,
and post-edit rename location. Monaco applies non-interactive text-edit refactors;
interactive variants remain surfaced as metadata until the caller supplies
arguments such as `targetFile`. Full playground prompt/post-edit-rename UI is
parked in `playground/ts-refactor-interactive-ui`.

## Verification

- `long-tail-parity.test.ts` compares applicable refactors and resulting edits
  against real TS, including extract-symbol rename metadata.
- `getMoveToRefactoringFileSuggestions` is exposed for move-to-file interactive
  arguments; unavailable refactor edits return an error frame, not a successful
  no-op.

## Reversibility

REVERSIBLE — additive engine method + worker frame + playground provider, no public
SDK-shape change beyond more LSP-typed returns. Recorded here; no ADR (extends
ADR-0166's already-Accepted phased scope, no contradiction).
