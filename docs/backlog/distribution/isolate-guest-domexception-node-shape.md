---
area: distribution
status: draft
title: The isolate guest's `DOMException` has Node's shape — `message` a prototype getter, not an own property
created: 2026-11-26
why: every abort reason in the isolate (`AbortSignal.abort().reason`, `AbortSignal.timeout`'s, `controller.abort()`'s default) is the guest's own `DOMException`, whose own keys differ from Node's
epic: isolate-guest-web-api
sources: [docs/adr/distribution/0579-isolate-guest-eventtarget-event-customevent-abortcontroller-and-abortsignal-are-node-v24-16-0-s-event-target-js-and-abort-controller-js.md, PR-472]
code: [packages/isolate-guest/src/guest/web-shim.ts, packages/isolate-host/tests/abort-event-target.test.ts]
---

## Context

Found by unit `distribution/isolate-stream-core-abort-controller` (PR #472), whose classes use the
guest's existing `DOMException` (`web-shim.ts`, `class DOMException extends Error`, also `Blob`'s).
Measured 2026-11-26, `sandbox.exec` and `runCode` vs Node v24.16.0:

| observation | Node | isolate |
|---|---|---|
| `Reflect.ownKeys(new AbortController().abort() … signal.reason)` (default reason) | `stack` | `stack,message` |

Node's `DOMException` (`lib/internal/per_context/domexception.js`) keeps `name`/`message`/`code` in
private state behind prototype getters with `ERR_INVALID_THIS` brand checks. `name`, `code`, `message`
values, `instanceof` and the global's descriptor equal Node (`abort-event-target.test.ts`); other
members (brand checks, legacy constants on the class, `util.inspect`) not measured here. Related:
`runtime-js/isolate-domexception-report-shape` (fatal-report printing). Pinned declared row:
`abort-event-target.test.ts` `CASES_DECLARED['default reason own keys']`. Compat: `isolate-host.md`
row `EventTarget`, … (ADR-0579).

## Challenge

challenge: 2026-11-26 — none (finding capture; README §Challenge)
