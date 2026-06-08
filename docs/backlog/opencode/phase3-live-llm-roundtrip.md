---
area: opencode
status: active
title: F08 Phase 3 — live LLM round-trip against a real endpoint+key (ratifies ADR-0061)
created: 2026-06-08
why: the single next unblocked M12 step; wired + dry-run-verified, needs a reachable endpoint+key (SPEND, confirm-first)
sources: [TASKS M12 F08, docs/opencode/README.md §Phase 3 / §Single next step, decisions.md ADR-0061 + C1 pre-flight, Q-2026-05-30-114/115/116, ADR-0010, ADR-0069, audit-digest]
---
## Context
Create a session + do one LLM round-trip — the single next unblocked step. WIRED + dry-run-verified: harness `opencode-phase3-smoke.ts` + `opencode-llm.opt-in.test.ts` drove the FULL pipeline against an unreachable endpoint — `POST /session` → prompt → tool resolution → `llm.provider=oai-compat` → a real `globalThis.fetch` POST to `/v1/chat/completions` with a valid OpenAI body, failing only on connection-refused. 3 general runtime walls cleared en route (each parity-tested): `node:http` `STATUS_CODES`; `Readable.setEncoding` (ratified ADR-0069 — POST-body reads); `fs.statSync {throwIfNoEntry:false}`. Added `@ai-sdk/openai-compatible@2.0.41` to facade deps.
## Options / Next
Remaining: run the LIVE round-trip. `RIFTY_OC_BASE_URL=… RIFTY_OC_API_KEY=… RIFTY_OC_MODEL=… RIFTY_RUN_OPENCODE_LLM=1 pnpm exec vitest run opencode-llm.opt-in`. Endpoint+key via env (Q-2026-05-30-116, D-004; sandbox-disabled, read the user's env, don't echo/check it). This is a SPEND + external call → CONFIRM-FIRST. node:https→fetch SPLIT (ADR-0061): C1 pre-flight CLEARED — `ai@6`/`@ai-sdk/*` use `globalThis.fetch`, ZERO `https.Agent`/`node:https` touch, so the Option-A client→fetch split is NOT required for the LLM path (node:https stays loud-throw; split remains a valid general capability if some other dep falls back). Q-115: drive P4 with a buffered (non-stream) completion to avoid the ServerResponse drain/pipe + SSE gaps.
## Reversibility
IRREVERSIBLE: ADR-0061 (supersedes immutable ADR-0010, preserving no-silent-plaintext) RATIFIES once a real endpoint+key returns a non-empty assistant reply. Confirm-first gate (outward spend/network per ADR-0064). Q-114/115/116 reversible (harness env), await end-of-M12 review.
