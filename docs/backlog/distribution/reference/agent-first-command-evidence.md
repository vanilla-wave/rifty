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
| poisoned-cache | ADR-0440 resource snapshot: caller-visible reports cannot rewrite admitted resources | mutated reload report still refuses both command kinds |

## Verification

- RED on baseline: `pnpm exec vitest run tools/agent-bench/src/project-resources.test.ts`
  → 10 failed / 37 passed, actual `done` instead of refusal; controls green.
  Log: `/private/tmp/first-command-red.log`.
- Browser RED: `RIFTY_PLAYGROUND_PORT=53147 pnpm exec playwright test --project=chromium-heavy --workers=1 tests/e2e/ai-mode.spec.ts -g 'first pi command'`
  → 1 failed, first `/skill:deploy` actual `data-status=done`, expected `error`.
  Log: `/private/tmp/rifty-admission-red-e2e.log`. Initial fixture setup failure
  (missing Settings before seed) was corrected before this behavioral RED.
- RED commit: `3c66d1930`. Browser GREEN for first command and existing
  project-resource/reload scenario: 2 passed; `/private/tmp/rifty-admission-green-e2e.log`.
- Public pinned pi 0.85.1 session `steer` / `getSteeringMessages` compares actual
  skill/template expansion with rifty refusal over the same real files. Includes
  ignored/malformed templates, hidden skills, whitespace, paths and `reload.md`.
- Completed draft `agent-chat-first-command-admission` removed; historical PR
  #347 findings remain history. Its P2 test comment now describes validation reads.
- Additional RED during repair: classifying the `pending` result trusted the
  caller-visible reload report. Clearing its arrays bypassed refusal (1 failed,
  62 skipped). Admission now reads the private resource snapshot after the wait;
  no extra read or snapshot owner.
- GREEN: agent package + project-resources suite, 82 passed / 6 files;
  `/private/tmp/rifty-admission-green-unit.log`.
- Revert checks: removing refusal gives 7 failing public-session tests;
  removing draft restoration gives browser failure (expected `/skill:deploy`,
  actual empty input). Logs `/private/tmp/rifty-admission-mutant-{guard,draft}.log`.
  Both temporary changes restored. A draft mutant attempt on the default port
  used another checkout and was discarded; recorded result uses port 53147.
