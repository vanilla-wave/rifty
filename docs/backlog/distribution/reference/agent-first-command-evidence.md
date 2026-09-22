# First-command refusal repair

User request: repair PR #347 P1, verify, address valid PR comments, merge.
Baseline: `b1467da1177af47317eb8b72722296f4a99cea63` (main after #348).
Decision: ADR-0442; prior resource/lifecycle authorities ADR-0440, ADR-0424.

## Root cause

`AiChatPanel.send` classified `resources()` before `ensureSession()` created
the first session. Undefined report meant literal input; `session.run` then
awaited discovery and dispatched without checking the now-known command.
The same split applies to skills and prompt templates, and direct session
consumers had no refusal. Owner: session admission, before model/history.

## Sweep

Searched `unsupportedChatCommand`, `skill:`, `promptTemplates`, `await pending`
and `.send(` in agent, playground, agent-bench, e2e and examples. One UI
classifier, two expansion kinds; session `send` is the shared dispatch path.
`reload`, `stop`, `reset`, `dispose` share the existing pending-read/run owner.
No new coordination mechanism. Relocate the classifier; remove its UI copy.

## Fault matrix

Boundary: Owned in-process policy/graph projection. Transport loss, duplicate
delivery and reorder excluded: the wrong value is born in a synchronous
classification of an absent report before session creation, before any model
transport. No new storage write or cache authority; existing resource snapshot
and explicit reload remain authoritative.

| Axis | Traced obligation | Carrier |
|---|---|---|
| observable-order | ADR-0442 §1: classify after resource read and cancellation/budget checks | public send pending-read, reload, budget and Stop/dispose cases |
| provenance-lie | User P1 / ADR-0442 §2: no apparent skill/template execution through literal forwarding | first command error, zero model requests and unchanged transcript; browser first command |
| sibling-drift | ADR-0442 §1: first/later and skill/template commands share admission | public send first/repeated/reset/reload cases |
| corrupt-input | ADR-0442 §1: paths, comments, unknown/ignored/malformed templates remain literal | slash controls and pinned pi discovery/classification |
| false-fallback | ADR-0440 §1: failed startup visible, reload recovery; no UI wait | failed startup and recovery case |

## Verification

- RED on baseline: `pnpm exec vitest run tools/agent-bench/src/project-resources.test.ts`
  → 10 failed / 37 passed, actual `done` instead of refusal; controls green.
  Log: `/private/tmp/first-command-red.log`.
- Browser RED: `RIFTY_PLAYGROUND_PORT=53147 pnpm exec playwright test --project=chromium-heavy --workers=1 tests/e2e/ai-mode.spec.ts -g 'first pi command'`
  → 1 failed, first `/skill:deploy` actual `data-status=done`, expected `error`.
  Log: `/private/tmp/rifty-admission-red-e2e.log`. Initial fixture setup failure
  (missing Settings before seed) was corrected before this behavioral RED.
