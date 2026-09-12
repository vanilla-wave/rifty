---
area: distribution
status: draft
title: AI-sandbox reference demo — LLM-generated Node runs client-side
created: 2026-06-28
why: OSS agent-builders refusing closed/metered WebContainers have no working open reference that runs LLM-generated Node client-side — but the live-preview path is not yet reachable through public @riftydev/* API
user_story: As an OSS AI-tool builder, I want a working open reference where an LLM writes a Node/Express app that npm-installs and previews in my own browser tab with my key never leaving the page, but today rifty ships no such demo and the eval-booted-server→preview path is not public.
epic: open-bolt-ai-sandbox-demo
blocked_by: [distribution/public-api-ai-agent-preview-question]
sources: [docs/research/open-webcontainers-alternative-2026-06.md, docs/backlog/distribution/public-api-ai-agent-preview-question.md]
code: [packages/npm-client/src, packages/rifty/src/sandbox.ts, tests/e2e/fullstack-demo.spec.ts]
---

## Context

2026-09-11 baseline update: ADR-0418 delivers cancellable no-COI project
commands and file methods. Existing toolchain.startBin already exposes a
resident previewUrl (ADR-0377). The historical eval-only analysis below needs
revalidation at demo pickup; the linked residual is a preview question, not
an assumed missing API or authorization to implement one.

This remains a draft: choose and prove the actual demo's public SDK route at
pickup. The original eval-driven proposal has not established that demo flow.
Use the existing no-COI project command/install proofs and resident previewUrl
as the current baseline; generic eval and resident-bin flows are distinct.
The inherited preview question records what still needs consumer evidence.

## Options or Next

- Spike the install→eval-`require` path against public API only (no playground glue). If it works, the **code-runner slice** — LLM → stream code → `npm install` via `@riftydev/npm-client` → `eval()` runs it → stdout/result streamed to the UI, NO live web preview — can split off as its own `ready` item.
- At live-preview pickup, resolve `distribution/public-api-ai-agent-preview-question` against the real demo scenario. A new API/ADR is required only if the existing public route cannot deliver the selected behavior.
- Demo lives in `examples/` (in-repo consumer, CI-tested), framework-free or Monaco (non-solid, D-002). Key in-memory only (never OPFS/logged). Responses bounded/finite-SSE (unbounded → HTTP 502). README must state the selected execution/preview route and its limits and that npm tarballs transit the proxy origin (so "$0 self-host" = stand up your own proxy too).
- Out of scope regardless: host-operator resource containment (trust-model is cooperative-only — never imply safe for hostile/multi-tenant code); the Pi harness; a create-rifty scaffold.
- Use consumer evidence to prioritize remaining preview and snapshot/fork needs; cancellable no-COI commands already have ADR-0418.

## Reversibility

The example is a reversible consumer in `examples/`. Keep it draft until its
selected public route has an executed demo proof. The inherited preview question
prescribes no new API; any demonstrated irreversible seam needs its own ADR.
