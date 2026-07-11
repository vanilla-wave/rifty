---
area: playground
status: ready
title: Install-stamp authority — one serialized owner for every stamp transition
created: 2026-07-11
why: the stamp's trust invariant is held by ~7 scattered mechanisms across 3 modules; each new writer/interleaving is a review-round-found trust bug (PR #131, 42 findings) — consolidate into one state machine, delete the scatter
user_story: As a developer, I want reload/switch/two-terminal installs at any moment to always reopen a provably honest tree, but today that holds only because seven hand-rolled guards each close one known interleaving — the writer-set invariant has no owner.
epic: trusted-state-authority
blocked_by: []
sources: [docs/adr/playground/0216-install-tail-latency-background-command-durability-generation-guarded-stamps-learned-pin-swr.md, docs/process/fault-classes.md]
code: [packages/workbench/src/glue/install-stamp.ts, packages/workbench/src/glue/npm-shell-command.ts, packages/workbench/src/glue/project-deps.ts, packages/workbench/src/workers/real-vite-bootstrap.ts]
---

## Context

ADR-0216 §audit (r1–r5): the stamp file has 6 writers (command demote,
command deferred promote, boot promoter, from-scratch clear, instant restore,
restampSlug) over 2 storage planes (mirror/OPFS), coordinated by 7 mechanisms
added one review round at a time (generation, phase lock, stamp-write chain,
promotionId, sync recheck-at-write, demote-proof ladder, prepare hook +
activity flag). Every KNOWN window is RED-proven closed; the CLASS
(`torn-state` × multi-writer) stays alive because the invariant "every stamp
transition goes through one serialized authority" is enforced by nothing.

## Acceptance

- One module (`install-stamp-authority`) owns the claim state machine:
  `absent → pending → trusted`; verbs `demote(identity)`, `promote(identity,
  payload)`, `revoke()`, `check()`. ALL transitions internally serialized;
  `promote` gates on durable-proof (drain + FULL-ledger check of the guarded
  scope `<root>/node_modules` and the claim file); `demote` of a trusted
  claim returns only PROVEN durable (write → rm fallback → loud abort, mirror
  restored on abort); identity is BYTE-exact (package.json text), never a
  flattened map; stale writers are fenced by a per-claim epoch issued at
  `demote` (replaces generation + promotionId).
- The scattered mechanisms are DELETED, not wrapped: npm-shell-command's
  generation/chain/ladder/sync-recheck, project-deps' promotionId +
  pendingPromotionStillCurrent, and the bootstrap's stamp-state peeking all
  become authority verb calls. Net LOC in the three call-site modules goes
  DOWN.
- Writer-set invariant is machine-enforced: a source-grep/arch gate fails the
  build when any file outside the authority module writes
  `.rifty-install-stamp.json` paths (pattern-level, like check:source-grep).
- One contract suite (`describe.each`) runs the authority's state machine +
  fault rows over MemoryVfs, SyncMirrorVfs, and the OPFS-backed pair — a
  lenient sibling impl can never again void a strict-impl proof.
- Behavior-preserving: every existing stamp test in npm-shell-command.test.ts
  / project-deps.test.ts / the integration + e2e specs stays green with
  asserts unchanged (test PLUMBING may re-wire to verbs; asserted outcomes
  may not change).

## Parity cases

N/A — browser-only durability tier (the stamp has no Node analogue); npm
parity of install exit semantics already pinned by ADR-0216 tests.

## Fault matrix

| Fault | Expected outcome | Proof |
|---|---|---|
| Two writers race demote vs promote (any pair of the 6 writers) | chain order decides; stale epoch fenced at the write slot — never a trusted claim over a newer pending | contract suite: interleave rows per verb pair |
| Death (reload/tab-kill) at ANY point of any verb | on-disk claim reads pending/absent → consumer redoes work; never trusted-over-torn | contract suite death-injection rows (existing e2e fast-reload case stays) |
| Demote/rm of a trusted claim never persists (quota) | loud install abort BEFORE mutation; mirror restored so retry re-proves | existing r4 tests re-pointed at the authority |
| Claim file write lands, guarded-scope persist fails | promote refused, loud warning, next boot re-installs | existing dirty-drain tests re-pointed |
| Identity drift during guarded work (package.json byte change, incl. section move / overrides) | promote refused loudly | existing r5 byte-exact tests re-pointed |
| Lenient Vfs sibling (auto-mkdir etc.) | contract suite fails the impl, not production | describe.each over all impls |

## Out of scope

- Generalizing beyond the install stamp (`vfs/trusted-state-primitive`,
  gated on a second consumer).
- Multi-tab / cross-realm claim ownership (Web Locks) — the multi-tab epic.
- Any user-visible behavior change.

## Decisions

- IRREVERSIBLE-ish module boundary → new ADR at implementation start
  (supersedes the coordination clauses of ADR-0216 §2; the audit section
  already names this as the not-delivered structural kill).
- The claim stays a real file at the current path (honest, cat-able,
  delete-with-tree = revocation) — no registry/hidden state.
