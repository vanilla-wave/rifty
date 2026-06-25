---
area: toolchain-build
status: parked
title: TS language service — refactorings (getApplicableRefactors / getEditsForRefactor)
created: 2026-06-22
why: ADR-0166 ships the tsserver core (diagnostics→formatting) but the refactoring surface is the long tail — the LS exposes NO method for it and Monaco's built-in `refactor.*` code-actions stay retired (no competing stub)
user_story: As a rifty playground/agent user, I want VSCode-style refactors (extract function/constant, move to new file, convert to named/default import, infer return type, …) over my real project + tsconfig, but today the LS has no refactor method, so the editor offers none and the agent can't request an edit-for-refactor
sources: [ADR-0166]
code: [packages/ts-language-service/src/service.ts, packages/ts-language-service/src/worker/protocol.ts, apps/playground/src/glue/ts-ls-monaco-providers.ts]
---

## Context

ADR-0166 §Scope lists refactorings as the deferred long tail. The engine wraps a
real `ts.LanguageService` but exposes no refactor surface; `service.ts` has no
`getApplicableRefactors`/`getEditsForRefactor` and `worker/protocol.ts` carries no
frame for them. The playground retired Monaco's built-in `codeActions` (incl.
`refactor.*` kinds) in task 2.2c — so there is NO competing built-in stub, the
gap is an honest absence.

## Options or Next

Honest acceptance (NO partial delivery): when taken up, MUST deliver ALL of —
- Surface the real `ts.LanguageService.getApplicableRefactors(fileName, positionOrRange, prefs)`
  and `getEditsForRefactor(fileName, fmt, positionOrRange, refactorName, actionName, prefs)`,
  mapped to LSP `CodeAction[]` (kind `refactor.*`) + `WorkspaceEdit` (reuse
  `fileTextChangesToWorkspaceEdit`); wired as a Monaco code-action provider for the
  `refactor.*` kinds (page↔owner↔LS relay, CancellationToken re-checked per hop).
- Parity vs the real `ts.LanguageService` (gold standard, same vendored TS both
  sides) for the applicable-refactor LIST and the resulting edits — at least
  extract-function, extract-constant, move-to-new-file (multi-file edit), and a
  conversion refactor — asserting the edits IDENTICAL to tsc's.
- Any refactor the engine cannot honestly support throws `NotImplementedError('ts-language-service.<refactor>')`,
  never a stub/no-op edit that lies.
- Pre-resolved before claiming: refactors with an extra UI step (e.g. extract-to
  destination scope, the `interactiveRefactorArguments`) — either thread the choice
  through the protocol or loud-throw on the unsupported interactive variant; decide,
  don't silently pick a default.

## Reversibility

REVERSIBLE — additive engine method + worker frame + playground provider, no public
SDK-shape change beyond more LSP-typed returns. Recorded here; no ADR (extends
ADR-0166's already-Accepted phased scope, no contradiction).
