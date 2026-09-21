---
area: distribution
status: draft
title: Judge a pi-expandable chat command inside session admission, not before the first report
created: 2026-09-21
why: The playground chat refuses `/skill:<loaded skill>` and `/<template>` from the loaded-resources report; a `/`-input sent before the startup read settles has no report yet and is forwarded as plain text, where pi never forwards an expandable command
user_story: As a playground user whose very first message is `/skill:deploy`, I want the same refusal notice as on later sends, but today the text reaches the model because the resource report has not arrived.
sources: [docs/adr/distribution/0440-load-pi-project-resources-through-rooted-agent-hosts.md, docs/backlog/distribution/reference/agent-pi-project-resources-final-green.json]
code: [apps/playground/src/ai/AiChatPanel.tsx, apps/playground/src/ai/chat-command.ts, packages/agent/src/session.ts]
---

## Context

`unsupportedChatCommand` (chat-command.ts) judges against `resources()`, set by
the session's `resources` event. `createAgentSession` reads resources at start
and `send` awaits that read inside the run budget (ADR-0440 §1, ADR-0424 §7).
A UI-side wait before `send` was tried and reverted on PR #347 (independent
verify pass 5, `/tmp/pi-346-verify-5-block.json`): a failed startup read is
published only through `send`, so the wait hangs the first `/`-input and
`/reload`, and a slow read waited outside the budget lets a late request
dispatch. Advisory NOTE in pass 4; the accepted goal (Decisions: expansion out
of scope, I7 report only) does not require the first-send refusal.

## Options or Next

- Admission-side refusal: `send` rejects text pi would expand after its
  startup await, loud (`NotImplementedError('agent.promptTemplates')` shape),
  inside the budget; playground maps the error to the existing notice. Public
  API behavior change → ADR citing 0440.
- Alternative: a session accessor for the settled startup read that rejects on
  failure and obeys the budget; UI keeps the policy. Also public API.
- Carrier: e2e first-send `/skill:deploy` refused with 0 model requests, plus
  fault RED for failed and slow startup reads (no hang, budget kept).

## Reversibility

REVERSIBLE inside the package; the public `send` contract change is the
decision an ADR records.
