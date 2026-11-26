---
area: distribution
status: draft
title: A warm `runCode` pays for loading the whole guest bundle and running its install on every call
created: 2026-11-26
why: each call gets a fresh isolate (ADR-0557, ADR-0563), so every Node-sources unit (Blob, TextDecoder, the abort/event classes; next the stream core, 8c) adds its load-time cost to every warm call (next: the stream core's wiring, `runtime-js/stream-core-node-sources`, 8c); Node's globals are data properties, so the install cannot be made lazy
sources: [docs/adr/distribution/0563-run-runcode-in-a-pool-of-long-lived-worker-processes-each-hosting-many-isolates.md, docs/adr/distribution/0577-the-isolate-guest-s-textdecoder-and-textencoder-are-node-v24-16-0-s-encoding-js-with-exodus-bytes-for-utf-16-and-gb18030.md, docs/adr/distribution/0578-isolate-guest-blob-and-file-are-node-v24-16-0-s-blob-js-and-file-js-over-a-js-byte-store.md, docs/adr/distribution/0579-isolate-guest-eventtarget-event-customevent-abortcontroller-and-abortsignal-are-node-v24-16-0-s-event-target-js-and-abort-controller-js.md, docs/backlog/distribution/reference/isolate-host-sandbox-lifecycle-probes/README.md, PR-472]
code: [packages/isolate-host/src/child/main.ts, packages/isolate-guest/src/guest/entry.ts, packages/isolate-guest/src/guest/web-shim.ts, docs/backlog/distribution/reference/isolate-guest-load-cost/probe.mjs]
---

## Context

Found while measuring unit `distribution/isolate-stream-core-abort-controller` (PR #472; manager's
request 2026-11-26). A call is a fresh isolate: context + host bridge, the bundle compiled from the
worker's V8 code cache, the bundle's top-level evaluation (the shim, the runtime modules, the
`TextDecoder` sources), then `run`, whose `setUp` installs the process, timers, ceilings, `Blob`/
`File`, the abort/event classes and runs the entry (`child/main.ts:262-340`, `entry.ts` `setUp`).

Measured 2026-11-26, M3 Pro, macOS, Node v24.16.0, isolated-vm 7.0.2, load 5.1–5.8: worker-side
phases of one `run('1')`, medians of 150 alternating calls per bundle (`total` = the sum of the
phase medians), `memoryLimit` 256 (runCode's default). Command, repo root:
`node --no-node-snapshot docs/backlog/distribution/reference/isolate-guest-load-cost/probe.mjs 150 <the five guest.js, in the table's order>`;
older bundles built per its header (a checkout of the six packages at the revision; files added
later stay, unread). How the probe differs from the worker: its header.

| bundle (`guest.js` B) | isolate+context+bridge | compile (code cache) | bundle top-level | `run('1')` | dispose | total ms |
|---|---|---|---|---|---|---|
| main `c2250727d`, before Blob (7 181 525) | 0.79 | 1.62 | 7.43 | 4.98 | 0.22 | 15.04 |
| `e430522e8`, + Blob/File #458 (7 223 180) | 0.79 | 1.65 | 7.52 | 5.21 | 0.22 | 15.40 |
| `aa7b332cc`, + #460/#462/#467/#469/#465 (7 231 189) | 0.80 | 1.68 | 7.55 | 5.21 | 0.23 | 15.46 |
| `be99bee9e`, + TextDecoder #459 (7 383 235) | 0.80 | 1.74 | 8.10 | 5.22 | 0.23 | 16.09 |
| PR #472 `735bbd049`, + abort/event classes (7 441 458) | 0.80 | 1.76 | 8.31 | 5.66 | 0.23 | 16.77 |

Per unit: Blob +0.36 ms (run +0.23), TextDecoder +0.63 (top-level +0.55: loaded with the shim;
ADR-0577 measured its class and bindings at ~0.1 ms in a `vm` context — the rest is a hypothesis:
the larger bundle's cache deserialization and lazy compiles, unmeasured), abort/event +0.68
(top-level +0.21, run +0.44); the three units +1.67 ms, +1.73 with the other merges, 11.5 % of the
15.04 ms base. Not decomposed: what the 7.4 ms top-level (shim, the runtime's module graph) and the
5.0 ms `run` (`setUp`'s parts, the eval entry and drain) consist of.
Consumer side (`runCode('1')`, `reference/isolate-guest-load-cost/warm.mts`, alternating triples,
n = 200): Blob +0.37 ms (95 % 0.27–0.47; base 15.52 ms; ADR-0578: +0.27–0.72, median of 40),
TextDecoder +0.53–0.67 (ADR-0577), abort/event +0.60 (95 % 0.56–0.64, n = 300, base 15.89 ms;
ADR-0579).
At `memoryLimit` 128 the same calls cost more: `c2250727d` 15.56, `be99bee9e` 18.47, PR #472 19.21 ms
(`LIMIT=128`; Blob alone +2.1 ms in `run`, against +0.23 at 256) — not explained here (GC is the
hypothesis, unmeasured). Not measured: Linux; the stream core (8c).

What exists in isolate-host today:
- V8 code cache: produced on a worker's first call, reused after (`child/main.ts:293-303`, ADR-0563:
  13 ms warm vs 60 ms without).
- One isolate per call, never reused (ADR-0557 freshness, ADR-0563); no startup snapshot; no spare.
- Per-call inputs fixed before or at the bundle's load: `memoryLimit` at isolate creation
  (`child/main.ts:155`), `timeOrigin` and `allowSharedArrayBuffer` in the bridge the shim reads and
  deletes at load (`main.ts:286`, `web-shim.ts:14-19`), the bridge itself made per call.

## Question

Owner: user — whether a per-call budget exists (the goals record «cost measured, no bound»);
agent — the carrier, once one is wanted. Which carrier, if any, removes per-call load cost without
giving up a fresh realm per call? Candidates, unchosen:
- a V8 startup snapshot of the booted bundle (`ivm.Isolate.createSnapshot`, `new ivm.Isolate({ snapshot })` in isolated-vm 7.0.2, whose README says not to use it: «increasingly unstable due to changes in v8», for code that «only defines functions, class, and simple data structures»); it covers the top-level only — `run`'s `setUp` stays per call unless moved — and the per-call inputs above are read at load;
- a pre-warmed spare isolate per worker, booted off the call's path (arm v1w of the lifecycle probes, PR #454: «removes only v1's fixed cost, at 2× v1's memory», only while a spare is ready); the per-call inputs above are read at its boot;
- less work per call (the runtime's module graph at bundle load, the Node-sources units' installs) — needs the decomposition above first.
- Outside this question (it gives up the fresh realm, sandbox `exec` only, user-owned and deferred): a live isolate per sandbox turn, `distribution/isolate-host-sandbox-live-isolate-per-turn`.

## Challenge

challenge: 2026-11-26 — none (finding capture; README §Challenge)
