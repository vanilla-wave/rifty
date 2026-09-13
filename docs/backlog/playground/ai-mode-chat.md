---
area: playground
status: ready
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

## Reference contract

Delivered Pi core and both public hosts: core Final+GREEN @ 523628b0c,
no-COI Final+GREEN @ 1989bdfca. UI preserves their tool/event/recovery meanings.
Playground owns terminal presentation, file/editor/SCM subscriptions and selected
preview. ADR-0427 records the integration and unchanged PR-111 close/reset shape.
Raw source decisions remain in the goal's refine/FIT evidence.

## Acceptance

1. Real react-vite starter → +chat → scripted model edits a source file, runs
   npm build in a labeled visible Agent terminal and inspects the actual preview.
   Tool arguments/results, changed editor/SCM and rendered content are visible;
   streamed text appears while completion is still pending. → I5
2. Endpoint/model survive reload; key, limits and conversation do not. A supplied
   key reaches only its configured transport and is absent from persisted
   settings/export. Bad stored settings recover to a usable form; refused storage
   remains usable with an explicit persistence notice. → I2 + I5
3. Stop cancels a real active command, retains completed tool results and permits
   the next message/command. Provider failure after a write displays the error;
   continuation keeps the write/history. Budget exhaustion is visually distinct.
   Export includes the actual transcript/tools/output/timing/usage/diff. → I3 + I4 + I5
4. Reset clears conversation without reverting files. Close stops/clears the
   session; reopening is fresh. Project switch binds a fresh conversation and
   cannot send old-session work to the newly selected project. Applying settings
   explicitly starts a fresh conversation; running controls prevent conflicting
   actions. → I5 + ADR-0427
5. A cold page that never opens +chat fetches no agent/Pi implementation chunk.
   Existing IDE remains visible beside the panel at ordinary desktop width;
   executed screenshot/geometry and keyboard controls prove the layout. → I5
6. Unreachable model endpoint gives a visible error naming the configured dev
   proxy remedy. A live no-auth model on the user's codex-proxy streams, performs
   the requested React edit/build/preview workflow and exports its trace. → I5
7. Only ?agentBench=1 exposes seed/exportTrace/session metadata; ordinary pages
   have no hook. Seed uses public files, prompt still goes through the chat UI,
   and metadata reflects the actual session/model/limits. → I8

## Parity cases

1. UI shell shares ProjectTerminal/PlaygroundTerminalUi settlement and output:
   real Stop ends the command before the next command and visible busy state
   reflect the settled owner. Core native parity evidence is reused. → I3 + I5
2. Native Pi completion/error/tool results keep their meanings when rendered and
   exported; the UI does not infer success from consumer payload contents. → I2 + I5

## Fault matrix

| Boundary / fault | Honest outcome | Proof / trace |
|---|---|---|
| provider / torn-state after write | visible error, committed write/history retained | error-continuation UI scenario → I3 + I5 |
| command / cancellation | physical Stop, retained partial outcome, next command | Stop UI scenario → I3 + I5 |
| provider / unbounded-read | core time budget, distinct UI status, usable next request | budget UI scenario → I4 + I5 |
| settings / corrupt-input or storage refusal | usable defaults or in-memory settings; persistence failure visible | settings UI scenario → I5 |
| project/panel lifetime / sibling-drift | stopped old session; new project gets a fresh session | close/switch UI scenario → I5 + ADR-0427 |
| endpoint / unreachable | visible error and dev-proxy remedy | network UI scenario → I5 |

## Out of scope

- "vibe" layout; approve gate; chat persistence across reload (export is the
  persistence story); multimodal input.
- Endpoints unreachable from the browser (CORS) fail with an explicit error
  naming the dev-proxy escape hatch — never a silent hang.

## Decisions

ready-verdict: 2026-09-13 — Contract+RED @ d33b8de82a7ceeb26f749a627e33473bedab0774
- 2026-09-13 — fresh /root/ui_contract_review: 15/15 coverage, no blockers; three proof concerns retained for GREEN (late lifecycle, expanded results, lazy graph); same raw JSON in `reference/ai-mode-chat-contract-red.json`.
- 2026-09-12 — PICKUP: reuse final-checked goal/source frontier and unchanged premise; ADR-0427 binds current public hosts and existing terminal UI owner. Close follows PR-111 unmount/dispose; Stop retains history; endpoint/model-only persistence follows the user's amendment.
- 2026-09-12 — preparation/evidence and executed RED: `docs/backlog/playground/reference/ai-mode-chat-evidence.md`; per-session limit controls expose the already-delivered core limits, never persist them.
- 2026-09-12 — e2e (CI, no real model): mock OpenAI-compatible streaming endpoint → send message → agent writes a file + runs a shell line → both tool calls visible → file visible in editor/preview → exported trace holds transcript, tool calls, diff.
- 2026-09-12 — manual streaming check against the real (no-auth) endpoint stays a PR-author acceptance line, documented in the PR.
