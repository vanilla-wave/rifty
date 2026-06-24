---
area: playground
status: shipped
title: TS LS on-type formatting provider
created: 2026-06-22
why: on-type formatting (`;`, `}`, newline) is served by the rifty LS so Monaco's built-in TS worker remains retired without losing the VSCode-like path
user_story: As a rifty playground user, my code is re-indented/spaced as I type trigger characters through the real TS service
sources: [ADR-0166]
code: [packages/ts-language-service/src/service.ts, packages/ts-language-service/src/worker/protocol.ts, apps/playground/src/glue/ts-ls-client.ts, apps/playground/src/glue/ts-ls-monaco-providers.ts, apps/playground/src/components/EditorHost.tsx]
---

## Context

Landed 2026-06-22: `getFormattingEditsAfterKeystroke` is exposed through the
engine, worker protocol, page client, and Monaco on-type formatting provider for
`;`, `}`, and newline, with parity against the real TS service.

This shipped item is retained as the delivery record. Rifty owns document, range,
and on-type formatting through the real TS service; Monaco's built-in TS worker
formatting stays retired.

## Verification

- Engine/client/provider path: `getFormattingEditsAfterKeystroke` with triggers
  `;`, `}`, and newline.
- `long-tail-parity.test.ts` compares after-keystroke edits against real TS using
  the same format settings as document/range formatting.

## Reversibility

REVERSIBLE — additive engine method + worker frame + playground provider, no public
SDK-shape change. Recorded here; no ADR (extends ADR-0166's already-Accepted phased
scope; the engine formatting surface already exists).
