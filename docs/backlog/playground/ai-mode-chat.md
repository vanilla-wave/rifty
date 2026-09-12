---
area: playground
status: draft
title: Playground "+chat" AI mode as the reference UI over the headless agent core
created: 2026-09-12
why: the goal needs a hands-on AI mode and a real chat UI for the bench's `rifty` lane; PR #111's `AiChatPanel.tsx` targeted a playground whose App/adapters were replaced by the sealed Workbench composition
user_story: As a playground user, I want to toggle AI mode, point it at an OpenAI-compatible endpoint (no key required) and vibecode the react-vite starter while the agent edits files, runs the visible agent terminal and checks the preview, but today the playground has no agent at all
epic: ai-agent-mode-and-bench
blocked_by: []
sources: [docs/backlog/epics/ai-agent-mode-and-bench/goal.md, docs/backlog/distribution/reference/ai-agent-mode-refine-evidence.md]
code: [apps/playground/src/adapters/playground-app.tsx, apps/playground/src/adapters/playground-terminal-ui.ts, apps/playground/src/components/PreviewPanel.tsx, apps/playground/src/components/ScmPanel.tsx, apps/playground/src/glue/ts-diagnostics-sync.ts, apps/playground/vite.config.ts]
---

## Context

One layout only — "+chat": right-side chat panel beside the existing IDE
(user 2026-09-12; #111's "vibe" view dropped, REV-7). Streams text deltas; each
tool call shows name + args + collapsed result; Stop aborts; Reset clears; done =
final assistant message without tool calls; `budget-exceeded` rendered
distinctly. Agent shell runs in a dedicated, labeled, visible terminal session
(same path as user sessions). Writes land directly; SCM reflects them.

Settings: `baseUrl` / `model` persisted (existing safe-storage pattern);
`apiKey` optional and session-memory only (user 2026-09-12: target endpoint has
no authorization). Dev-only CORS proxy route stays config-driven (D-004,
`/npm-registry` precedent in `vite.config.ts`).

AI code lazy-loaded (dynamic import; Pi chunks split): a session that never
opens AI mode downloads none of it (#111 measured +~2.4 kB eager entry).

Bench hooks: `globalThis.__riftyAgentBench` only under `?agentBench=1`
(`seed`, `exportTrace`, session/task metadata), each marked
`// agent-bench hook: external validation harness only. Not public API.`;
bench mode grants the agent nothing extra.

Quarry: `origin/ai-mode-mvp:apps/playground/src/ai/AiChatPanel.tsx`,
`settings.ts`, `index.ts`, `tests/e2e/ai-mode.spec.ts`,
`tests/e2e/ai-mode-parity.spec.ts` — rewrite over the current adapters.

## Challenge

challenge: 2026-09-11 — 6 problems (goal-level, verbatim in the evidence file; all resolved there)

## Out of scope

- "vibe" layout; approve gate; chat persistence across reload (export is the
  persistence story); multimodal input.
- Endpoints unreachable from the browser (CORS) fail with an explicit error
  naming the dev-proxy escape hatch — never a silent hang.

## Decisions

- 2026-09-12 — e2e (CI, no real model): mock OpenAI-compatible streaming endpoint → send message → agent writes a file + runs a shell line → both tool calls visible → file visible in editor/preview → exported trace holds transcript, tool calls, diff.
- 2026-09-12 — manual streaming check against the real (no-auth) endpoint stays a PR-author acceptance line, documented in the PR.
