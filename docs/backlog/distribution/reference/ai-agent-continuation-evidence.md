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
