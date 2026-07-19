---
kind: epic
status: draft
title: Open bolt.diy that actually runs — AI-sandbox reference
created: 2026-06-28
value: An OSS AI-tool builder runs LLM-generated Node code that npm-installs and previews entirely in the user's own browser tab — open, self-hostable, the API key never leaving the page.
user_story: As an OSS AI-coding-tool builder refusing a closed/metered WebContainers dependency, I want a working open reference where an LLM writes a Node/Express app that npm-installs and previews in my own tab with my key in-memory only, but today rifty ships no such demo and the eval-booted-server→preview path is not public.
items: [distribution/ai-sandbox-reference-demo]
---

## Outcome

In-browser Node + AI code-execution is a category with demonstrated demand (StackBlitz/Bolt built a business on the closed version), yet there is no OPEN, self-hostable reference. This epic is shaped around shipping one — aimed at OSS agent-builders and the open-runtime request in the bolt.diy tracker (#2008) — but is `draft`, not pickup-ready: its headline outcome (a booted server with a live web preview) needs a public API rifty does not yet expose. Its real payoff is a discovery signal, not vanity stars: which IRREVERSIBLE primitive the inbound asks for first (exec-streaming vs snapshot/fork) — so the next deep bet is chosen on evidence. Mission anchor: real Node software, AI-authored, running faithfully in the browser. AI lives OUTSIDE rifty (a consumer of `@riftydev/*`), per the M12 stance.

> External claims (the #2008 thread's current state, any Bolt revenue figures) are NOT verified in-repo — do not quote them as fact in the launch post without a dated source. The epic stands on the licensing-wedge demand that IS in `docs/research/open-webcontainers-alternative-2026-06.md`.

## User scenario

Target end state: an agent-builder opens the demo → pastes an OpenAI-compatible baseUrl + key (in-memory only) → prompts "build an Express API" → generated code streams into the editor → a visible `npm install` runs → the server boots → the SW preview responds — all in one tab, no backend, key never persisted. They read the honest note (eval-driven; no public `exec()` streaming / normalized preview URL / snapshot-fork — links to the parked items) and ask "can I build my agent on this?".

Staged honestly:
- **Phase 1 (achievable, once the install→eval-`require` spike passes):** a client-side code-runner — LLM → stream code → `npm install` via `@riftydev/npm-client` → `eval()` runs it → stdout/result shown. No live web preview.
- **Phase 2 (gated):** the live web-app preview — needs `distribution/public-api-ai-agent-exec-preview` (IRREVERSIBLE, own ADR). This is what makes the epic `draft` as a whole.

Replying in #2008 and posting the screen-recording are OUTBOUND/confirm-first acts — this scenario, not items.

## Items

- `distribution/ai-sandbox-reference-demo` (draft) — the examples/ consumer app + its honest eval-vs-exec framing. Blocked on `distribution/public-api-ai-agent-exec-preview` for the live preview; the Phase-1 code-runner slice can split off as `ready` once the install→eval path is spiked green.

Out of scope / downstream (link, do NOT pre-empt — all IRREVERSIBLE, own ADRs): `distribution/public-api-ai-agent-exec-preview` (the live-preview / exec primitive — the hard blocker), `distribution/public-api-ai-agent-contract-snapshot-restore`, `distribution/create-rifty-template`, `kernel/host-operator-resource-enforcement` (no containment for hostile/multi-tenant code). `distribution/publish-git-and-ts-language-service` is a soft dependency: agent-builders probe git/typecheck.
