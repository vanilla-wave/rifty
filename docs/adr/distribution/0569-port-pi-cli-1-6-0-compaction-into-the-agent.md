# ADR 0569: Port pi CLI 1.6.0 compaction into the agent

Status: Accepted (user-confirmed 2026-11-23)
Date: 2026-11-23

> TL;DR: Pi 1.x has no browser-safe compaction export; `@riftydev/agent` carries a
> differential-tested port of the CLI 1.6.0 algorithm until upstream ships one.

## Context

Pi 1.0.0 removed the harness from `@earendil-works/pi-agent-core` (compaction,
skills formatter, session entries, `convertToLlm`); agent-core 1.6.0 exports only
`Agent`, the loop and proxy. The only CLI-equivalent compaction lives in
`@earendil-works/pi-coding-agent`: exports map `.`/`./rpc-entry` only, and its root
does not bundle for the browser (esbuild `--platform=browser`: `node:fs`,
`node:path`, `child_process`, `node:events`, 2026-11-23); `core/compaction` itself
imports `session-manager` (fs). `@earendil-works/pi-durable` bundles but runs a
different algorithm (no split-turn prefix, no file lists, summary as a user
message, chars/3.5). ADR-0473 §1 ("native utilities, no copied summary algorithm")
cannot hold with a browser agent on pi 1.x.

## Decision

Overturns ADR-0473 §1 "use native `prepareCompaction`, `compact`, `convertToLlm` and
token estimators; no copied summary algorithm or second history ledger" for those
utilities and the skills formatter (ADR-0440); and ADR-0474 "no persistent second
message array": the CLI's compaction input needs entry ids (`firstKeptEntryId`,
omission targets) that audit receipts do not carry, so the session keeps a CLI
journal (`session.ts`) beside the receipts, cleared by reset.

1. `packages/agent/src/pi-cli/` ports, from pi-coding-agent 1.6.0 source (MIT,
   notice in `packages/agent/THIRD_PARTY_NOTICES.md`): the journal projection
   (`message`, `compaction` with `systemMessage`, null `context_edit` omission
   entries on one branch), estimators, projected cut point, preparation, summary
   prompts/serialization, `compact`, the `compactionSummary` message and
   `convertToLlm`, `formatSkillsForPrompt`. Nothing outside rifty's reachable
   entries (no extension hooks, branch summaries, codemode calls, model overrides).
2. Session follows the CLI 1.6.0 `AgentSession` observable rules: journal of every
   emitted message incl. prompt-state system messages; failed retry and overflow
   attempts persisted then omitted; pre-prompt `_checkCompaction` (aborted
   included), mid-run projected threshold, post-run overflow / recoverable-length
   compact-and-continue once per episode, the CLI's recovery-failed event text.
3. Prompt changes enter history as system messages (`sections.prompt`), diffed
   per run and turn, as the CLI does; Pi collapses them on wire. Rifty's prompt is
   one section, so a change re-sends it whole (the CLI diffs its own sections);
   restored foreign sections are removed with `null`.
4. Classifier (`isContextOverflow`, `isRecoverableLength`), retry and the loop stay
   native pi-ai/agent-core; no copy.
5. Oracle: `tools/agent-bench/src/continuation-parity.test.ts` runs the real CLI
   1.6.0 `AgentSession` and rifty over the same provider (20 scenarios + 40 seeded random traces); token
   numbers equal with the system section sizes equalized; system message
   positions and CLI file-operation lists compared. A copy tested only against itself does not count.
6. Kill condition: an upstream pi release exporting compaction/projection from a
   browser-safe entry → delete `pi-cli/` and import it (DEC-2 here). Every pi bump
   re-runs the parity suite; a diff is a sync, never a test edit.

## Alternatives

Critic (DEC-5, 2026-11-23): overturn HOLDS — forcing facts (a) no browser-safe 1.6.0
export, (b) CLI root fails browser bundling, (c) pi-durable differs, re-probed
independently; fixes taken: journal overturn named, file-op parity scenario added.


- Pin 0.99.2 (last harness release): keeps ADR-0473 but not latest; 1.x fixes lost.
- `pi-durable`: new dependency, different algorithm — breaks CLI parity (ADR-0434).
- Compaction off in the browser: regresses shipped ADR-0473 behavior.
- Bundler shim for CLI internals: deep imports past the exports map, Node graph.

## Consequences

- Known place: `entryIdOf` maps a message to its journal entry by position (agent state ==
  projection, installed at creation, after compaction and omission), where the CLI keeps an
  identity map; a future state writer that breaks the invariant breaks the mapping (the
  omission throws, as in the CLI).
- Rifty owns ~840 lines of upstream algorithm (`pi-cli/`); drift is caught only by the parity suite.
- Public: `CompactionSummaryMessage` type and its `CustomAgentMessages` augmentation
  ship from `@riftydev/agent`; transcripts carry `system` messages (pi 1.x history).
- Upstream issue text for a browser-safe export is in the PR; filing waits for the user.

## Corrections

2026-11-23 — user confirmation: «тут ок» (answer to «Компакция: подтвердить копию в rifty (ADR-0569) или остаться на 0.99.2…»). Manager's reading: this ADR is confirmed; the upstream issue draft is not filed (no explicit «подавай»).
