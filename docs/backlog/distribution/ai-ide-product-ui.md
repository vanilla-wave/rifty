---
area: distribution
status: parked
title: M12 — AI-IDE product UI (chat + streamed tool-calls / diff / approve) over the IDE-kit
created: 2026-06-13
why: the AI-IDE needs an agent-facing UI (chat, streaming tool calls, diff review, approve-gate, history) that generic rifty IDE atoms do not provide
user_story: As a dev assembling an AI-IDE product on rifty's IDE atoms, I want a ready agent-facing surface — chat panel, streamed tool-call (`onUpdate`) rendering, diff with per-edit approve-gate, session history — wired to the harness events, but today only generic editor/terminal/preview/filetree atoms exist; this product UI is unbuilt.
sources: [M12, docs/backlog/distribution/ai-ide-pi-agent-harness.md, docs/backlog/distribution/workbench-controllers.md, docs/backlog/distribution/framework-bindings-kit.md]
---

## Context

Generic IDE atoms (editor / terminal / preview / filetree) stay in rifty (EPIC C/D:
workbench-controllers + framework-bindings-kit). The agent-specific surface — chat panel,
streamed tool-call rendering, diff + approve-gate, session history — is PRODUCT UI on the
AI side, consuming those atoms plus the M12 harness events. Same boundary as D-002: the
generic kit is reusable; the agent UI lives in the consumer.

## Options or Next

- Chat + streamed tool-call (`onUpdate`) rendering; diff + per-edit approve-gate; history.
- Build over the IDE-kit atoms (depends-on EPIC C/D); reuse the existing playground editor/terminal/preview.
- Lives in the agent product (an `apps/` consumer or a separate repo), never in rifty packages.

## Reversibility

REVERSIBLE — product UI in the consumer; adds no rifty package surface. Recorded here.
