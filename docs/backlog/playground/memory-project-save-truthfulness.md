---
area: playground
status: draft
title: Truthful Project Save in memory fallback
created: 2026-07-15
why: memory fallback skips the owner tree/index Save but still turns the page mirror into a named Project
user_story: As a playground user whose browser falls back to memory storage, I want Save to create a real session-scoped project or refuse loudly, but today it claims a named Project that the owner never created.
blocked_by: []
sources: [ADR-0165, PR-145-scope-audit-2026-07-15]
code: [apps/playground/src/orchestration/save-flow.ts, apps/playground/src/glue/page-store.ts, apps/playground/src/glue/degraded-storage.ts, apps/playground/src/App.tsx]
---

## Context

This bug exists on `origin/main`; it was found while auditing PR #145 scope, not introduced by that PR. In memory fallback, `save-flow` deliberately skips the owner `saveIndexPhases` tree/index transaction, then still calls `page-store.confirmSave`. The page mirror removes Scratch, creates a named Project, changes `activeId`, and emits a saved-project toast. The later `EPHEMERAL (session only)` notice and storage badge describe lack of reload durability, but they do not make the missing owner tree/index transition real. The UI therefore claims a Project whose identity and root exist only in the page mirror. That violates the fidelity rule: an unavailable Project Save must be real for its advertised lifetime or fail loudly, never be a happy-path fake.

ADR-0165 currently says Save works in-session in memory mode and every affordance is marked ephemeral. A durable-only product ceiling proposed during the PR #145 scope audit would instead keep memory users in Scratch and withhold Project lifecycle operations. This draft does not treat that ceiling as settled: removing in-session Save contradicts ADR-0165 and changes observable product behavior, so it requires refinement and a superseding ADR-0165 decision. The other live alternative is a real owner-authoritative, session-scoped memory Project transaction with truthful switch/reset/delete semantics. No implementation should proceed until that irreversible product fork is resolved.

## User scenario

A user opens rifty in an isolated Chromium environment where OPFS is unavailable, picks the Vite Starter, edits `/scratch/src/main.ts`, and chooses **Save as “demo”**. Today the launcher shows `demo` as a Project and Scratch disappears, while the owner never moved the tree to `/projects/<id>` or committed a corresponding index entry. A later project operation observes page-mirror state that the owner cannot substantiate; reload loses it entirely. The honest result must be one of two refined contracts: create a real session-scoped Project in the owner and label it ephemeral, or leave the user in Scratch and reject/disable Project Save with an explicit durable-storage requirement.

## Refinement required

- Decide whether memory fallback supports real session-scoped Projects or only Scratch.
- If choosing the durable-only ceiling, supersede ADR-0165 rather than treating a review-time proposal as an implicit contract change.
- Define the exact owner source of truth and observable Save/switch/reset/delete/reload behavior before promoting this item to `ready`.
