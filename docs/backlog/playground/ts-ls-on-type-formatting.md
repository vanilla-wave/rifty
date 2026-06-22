---
area: playground
status: parked
title: TS LS on-type formatting provider (engine has doc+range; on-type not shipped)
created: 2026-06-22
why: ADR-0166 task 4.x shipped document + range formatting from the rifty LS, but on-type formatting (auto-format on `;`/`}`/Enter) is not — and Monaco's built-in `onTypeFormattingEdits` is retired (task 4.2c), so there is NO competing built-in
user_story: As a rifty playground user, I want my code re-indented/spaced as I type the trigger characters (`;`, `}`, newline) like VSCode, but today neither rifty nor Monaco does it — the built-in on-type formatter is turned off and the rifty LS exposes no after-keystroke edits
sources: [ADR-0166]
code: [packages/ts-language-service/src/service.ts, packages/ts-language-service/src/worker/protocol.ts, apps/playground/src/glue/ts-ls-client.ts, apps/playground/src/glue/ts-ls-monaco-providers.ts, apps/playground/src/components/EditorHost.tsx]
---

## Context

ADR-0166 shipped `getFormattingEdits` (whole document) + `getRangeFormattingEdits`,
wired as Monaco document/range formatting providers; task 4.2c `setModeConfiguration`s
OFF the built-in `onTypeFormattingEdits` so rifty owns formatting with no competing
built-in. But the engine has no after-keystroke method and no Monaco on-type provider
is registered — so on-type formatting simply does not happen (honest absence, the
built-in is off).

## Options or Next

Honest acceptance (NO partial delivery): when taken up, MUST deliver ALL of —
- Engine method over the real `ts.LanguageService.getFormattingEditsAfterKeystroke(fileName, position, key, settings)`
  → LSP `TextEdit[]`, behind a new worker frame (reuse `formattingOptionsToFormatCodeSettings`
  so the on-type settings match doc/range formatting exactly).
- Client method on `glue/ts-ls-client.ts` + a Monaco on-type formatting provider in
  `glue/ts-ls-monaco-providers.ts` registered with the real trigger characters
  (`;`, `}`, `\n`), CancellationToken re-checked across the relay hop.
- Parity vs the real `ts.LanguageService` (gold standard, same vendored TS both
  sides): after-keystroke edits for `;` / `}` / Enter on a mis-indented fixture —
  asserted IDENTICAL to tsc's (so a divergent setting fails parity, not hides).
- If a trigger key cannot be honestly supported it throws
  `NotImplementedError('ts-language-service.onTypeFormatting.<key>')`, never an empty
  edit set that silently lies about there being nothing to format.

## Reversibility

REVERSIBLE — additive engine method + worker frame + playground provider, no public
SDK-shape change. Recorded here; no ADR (extends ADR-0166's already-Accepted phased
scope; the engine formatting surface already exists).
