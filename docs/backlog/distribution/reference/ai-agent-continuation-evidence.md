# Continuation — preparation

I12 Final+GREEN: `2a145487f311710b337b2419b4aefca4b68202ad`.
RED: `packages/agent/src/continuation.fault.test.ts`, 2026-09-27:
8 failed / 3 passed; missing retry, compaction and context-exceeded behavior.
Raw log: `/private/tmp/rifty-pr359-continuation-red.log`.

Independent DEC-2 probes (actual pinned Pi 0.85.1):
- `/private/tmp/rifty-mechanism-decision-0851.{mjs,out}`: Agent/public utilities
  versus Harness; retries1/2/4, exhaustion4 requests, one tool effect.
- `/private/tmp/rifty-summary-carrier-0851.{mjs,out}`: native summary+details
  projection equals native Entry oracle through JSON restore/three compactions;
  completeSimple delegate retains request defaults; failed summary usage included.
- `/private/tmp/rifty-pr359-cli-continuation-probe.{mjs,out}`: actual public CLI
  two failures→three requests; exhaustion4; default pre-prompt compaction yields
  summary+tail and sends next request even when post-summary estimate is larger.
- `/private/tmp/rifty-pr359-cli-context-priority-probe.{mjs,out}`: actual CLI
  context5000→one request/no retry, whereas unguarded retry helper→four requests.

Mechanism sweep: existing Agent owns run cancellation and retained messages;
request boundary owns native retry only. Ephemeral Entry projection adds no
persistent ledger, correlation map, scheduler, lock or action replay authority.
Run cancellation must also reach summary work after Agent's loop settles.

Remaining GREEN proof: active-loop compaction, partial-response discard,
summary retry/full usage, malformed restore, no-usage estimates, real CLI
comparisons in committed tests, Chromium markers and explicit continuation.

Preparation corrections (native evidence, no scope reduction):
- `/private/tmp/rifty-pr359-cli-failed-summary-probe.{mjs,out}`: failed threshold
  summary → overflow → one separate summary attempt. Corrected false expectation.
- Overflow bound applies per consecutive overflow episode; successful assistant
  responses (including tool calls) reset native recovery. ADR-0473 clarified.
- Stop test now asserts summary request identity; separate default-backoff test;
  added native zero-usage estimate/event assertion before implementation.
- Updated RED `/private/tmp/rifty-pr359-continuation-red-v3.log`: 11 failed,
  2 passed. All failures behavioral assertions; no import/runtime harness failure.

# Implementation observations

- Initial 13 fault tests GREEN; extended 19 cases cover in-loop compaction,
  full failed-summary usage, switch during summary retry, restore/details across
  three compactions, malformed summaries, deadline and stale-model overflow.
- Actual CLI differential suite covers retries/exhaustion, partial proposal
  discard, one external tool effect, threshold, no-cut overflow, failed summary,
  stale model, repeated overflow episodes and silent usage overflow.
- New differential RED: CLI retains failed entries in its SessionManager even
  after dropping them from Agent.state. They participate in later cut points,
  summary text and token estimates. Latest-overflow-only projection is insufficient.
  `/private/tmp/rifty-pr359-continuation-event-parity-red.log` records the gap.
- Core `prepareCompaction` accepts an empty prefix and filters failed messages
  when estimating context; CLI declines empty prefix/cut and estimates persisted
  messages. Public native estimators remain the algorithm authority.
- The network fixture now waits 2 ms before stamping the settled response;
  otherwise zero-time responses alias native compaction timestamps and exercise
  its stale-response guard instead of a later request.

PR-4 criteria changes, accepted I5/I6:
- Existing catalog/network unit cases explicitly disable retry to keep testing
  one provider failure. No outcome assertion removed.
- Existing retained-write UI/no-COI fixtures return nonretryable HTTP400; the
  separate catalog UI case uses four HTTP429s and checks 3 retry notices, one
  write effect and retained-history model switch.
- Benchmark raw Agent status changes error→context-exceeded per I5; native CLI
  raw error remains error; common outcome/classifier remains context-exceeded.
- Native benchmark retry now explicitly uses Pi defaults3/2000/transport0;
  the frozen I12 config, tasks and artifacts remain unchanged.
- The initial tool retry test cloned tool functions at the fake network boundary;
  corrected to copy native DTO fields. Fixed fixture against frozen baseline:
  `/private/tmp/rifty-pr359-continuation-tool-baseline-red.log` fails 2 vs3
  requests; same current test passes.

Executed acceptance:
- `/private/tmp/rifty-pr359-continuation-chat-all.log`: 15/15 real Chromium chat,
  including retry exhaustion, compaction markers and larger-model continuation.
- `/private/tmp/rifty-pr359-continuation-lanes.log`: 5/5 real benchmark lane
  checks (COI/native overflow; COI/no-COI/native default retry and metrics).
- `/private/tmp/rifty-pr359-continuation-browser2.log`: isolated first chat open
  exceeded 5 s while source gate ran; unchanged isolated case subsequently
  passes in browser3 and the complete chat suite. No timeout loosened.
- First pr:check: catalog-metrics old status expectation reproduced in isolation;
  updated to I5. Second: formatting plus newly added repeated-overflow RED;
  neither gate is claimed green. Final gate remains pending.

DEC-2 projection repair: ADR-0474. Independent raw probes
`/private/tmp/rifty-projection-decision.mts` and
`/private/tmp/rifty-projection-retry-decision.mts` matched actual native persisted
context and preparation through repeated compaction. No additional persistent
message array. Journal/event differential GREEN:
`/private/tmp/rifty-pr359-continuation-journal-green.log`, 29/29.

Final native edge proof:
- `/private/tmp/rifty-pr359-continuation-native-final.log`: 11 actual CLI cases,
  including its retained-retry-tail `Cannot continue from message role: assistant`
  terminal failure. No arbitrary deletion of earlier errors.
- `/private/tmp/rifty-pr359-continuation-detail-red.log`: successful overflow
  recovery retained stale error detail; fixed to clear terminal done/aborted detail.
- `/private/tmp/rifty-pr359-continuation-abort-parity-red.log`: native retry helper
  synthesizes an aborted response for cancelled sleep, while CLI retains only the
  failed-attempt receipt. Suppress that synthetic response from Agent context and
  settled events; actual failed request usage/receipt remain.
- `/private/tmp/rifty-pr359-continuation-abort-green.log`: 20 fault +12 actual
  CLI cases GREEN, including cancelled backoff context equality.
- `/private/tmp/rifty-pr359-continuation-browser-final.log`: 2/2 focused Chromium
  acceptance after journal projection; full 15/15 chat proof above remains.

`/private/tmp/rifty-pr359-continuation-pr-check-final.log`: 25/25 PASS.
During this run the new abort-backoff differential test first reproduced the
adapter gap; automatic isolated rerun passed after the repair. This was a repaired
RED, not a claimed flaky failure. Fresh unchanged-tree confirmation follows the
implementation commit. Final typechecks and lint pass independently.

Final+GREEN PASS @ b353ed8b0: 28/28 rows, zero findings. Independent re-run32/32
(`/private/tmp/rifty-independent-continuation-green.log`), fresh unchanged-tree
pr:check25/25, no isolation (`/private/tmp/rifty-pr359-continuation-pr-check-proof.log`).
Verdict retained in `ai-agent-context-compaction-final-green.json`.
