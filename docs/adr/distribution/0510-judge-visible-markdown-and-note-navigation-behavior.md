# ADR0510: Judge visible Markdown and note navigation behavior

Status: Accepted
Date: 2026-10-06

## Context

ADR0506 own-origin checks; ADR0508 semantic captions, ADR0509 CSV values.
Actualpilot-v3 notes COI1 renders heading1/bold700/literalHTML in one paragraph,
errors0; exact-text element lookup0 wronglyfails. COI3 uses working Wiki buttons;
forcedlink-role timesout. NamedAlpha entry includesBeta body excerpt; substring
identity falsely reportsBeta still present. Public task leaves DOM/layout open.

## Decision

One primary-purpose matcher owns field descriptions, entry identity and target
navigation; known other titles disambiguate excerpts, delete actions excluded.
Wiki navigation accepts named button/link actions. Visible literal text may share
an element; editor source/hidden text cannot prove rendering. Any matching
heading/bold preview accepted; no global uniqueness requirement. Actual state,
search/persistence/delete/link assertions unchanged; no source-code scoring.

Freeze pilot-v4, newnotes-v3 path only; same project/prompt/controlbytes/families,
CSVv3 unchanged. Originalv1/v2/v3 casebytes/scores remain invalid-oracle history.
New helper bytes enter existing support hash; fresh72 after controls/review.
No resume/native rescue/re-scoring.

## Candidates/probe

- Exact element/link-role/global unique matching: old smallest interface,
  rejected by actual programmes and duplicate-preview functionalRED.
- Visible text + primary named action/entry: kept, small stateless shared owner;
  source/hidden/functional negatives retained. No universal language parser.

`node --import tsx tools/agent-bench/tests/notes-render-controls.ts pilot-v3`
→ actual1/3 andduplicateFAIL,referencePASS,4functionalnegativesFAIL/errors0.
NativeNode24.16.0/Chromium real installedVite. First narrowerfix stillmisread
Beta inAlpha excerpt; same-class owner fixed, final controls/gates/review recorded
in `docs/backlog/distribution/reference/agent-eval-notes-render-fix-evidence.md`.
