---
area: runtime-js
status: draft
title: "A fatal report runs only the Proxy traps Node's report runs"
created: 2026-11-23
why: rifty's fatal report runs Proxy traps (in an error's props, `cause`, or the thrown value) that Node's report does not; a trap that never returns hangs the report — to the deadline on the isolate host, with no deadline on the no-COI and COI browser hosts — where Node prints and exits 1
sources: [PR-421-external-review-round-3, docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/fatal-report.ts, packages/runtime-js/src/internal/proxy-identity.ts]
---

## Context

Found by the PR #421 external review (round 3), not in the corpus of
ADR-0571. Reproduced by this capture (2026-11-23):
`H = { <trap>(){ for(;;); } }`, `P = new Proxy({a:1}, H)`; shapes prop
`e = new Error('boom'); e.p = P; throw e`, cause `throw new Error('boom',
{cause: P})`, self `throw new Proxy(new Error('boom'), H)`. Node v24.16.0
`node -e` (3 s kill; `node <file>` gives the same exit/hang); rifty `runCode` from
`packages/isolate-host/dist` (built 2026-11-23 00:26, after HEAD eccbe3a9d),
`timeoutMs: 3000`:

| trap | prop | cause | self |
|---|---|---|---|
| `get` | Node exit 1 · isolate timeout | Node exit 1 · isolate timeout | **both hang** (`node <file>` prints the header first, `-e` nothing) |
| `ownKeys` | Node exit 1 · isolate timeout | Node exit 1 · isolate timeout | Node exit 1 · isolate timeout |
| `getOwnPropertyDescriptor` | Node exit 1 · isolate timeout | Node exit 1 · isolate timeout | Node exit 1 · isolate timeout |
| `getPrototypeOf` | Node exit 1 · isolate timeout | **both hang** | Node exit 1 · isolate timeout |
| `has` | both exit 1 | both exit 1 | both exit 1 |

Node prints a Proxy prop / cause as its target without traps (`p: { a: 1 }`,
`[cause]: { a: 1 }`, inspect's internal proxy details). rifty
(`fatal-report.ts`, read): `propValue` → `isErrorLike` runs `instanceof Error`
(`getPrototypeOf`) and `Object.prototype.toString` (`get`
`Symbol.toStringTag`), then rifty's `inspect`; `inspectError` reads keys and
descriptors on the thrown value. A thrown Proxy prints stackless even with
an empty handler: `throw new Proxy(new Error('boom'), {})` → isolate
`[Error: boom]` + trailer, Node `[eval]:1` header + `Error: boom` + stack (the
`stack` read through the Proxy gives no string). No-COI SDK and COI kernel child share this
formatter and have no run deadline (reviewer's report; code read, not probed
here — browser lanes not run in this capture).

Compat process.md "Fatal error stderr bytes" says rifty "runs Proxy traps,
which Node never calls — a trap that never returns holds the report until the
host's deadline": Node does call `getPrototypeOf` on a cause and `get` on a
thrown Proxy (table), and the browser hosts have no deadline — that sentence
needs the corrected facts with the fix (row owner: this item).
Fault: `sibling-drift` (rifty's inspect vs Node's proxy-aware inspect);
on the browser hosts also `unbounded-read` (a report loop with no bound).
Dedup: no backlog/traps/ADR-declined match for Proxy in the fatal report;
neighbours, not duplicates: `fatal-report-node-shape` (report shape),
`inspect-default-format-gaps` (inspect defaults),
`node-eval-header-from-throw-statement` (the `-e` header the `prop` row
also lacks).

## Question

How does the report tell a guest Proxy from its target? A pure-JS realm cannot
detect one (rifty's `util.types.isProxy` throws), but rifty has a
recorder (`internal/proxy-identity.ts`, wraps `globalThis.Proxy`; used by
`clone-marks.ts`) — whether it is installed on every fatal-report host, and
covers proxies made before install, is unverified. No recorder → the trap
calls stay a declared ⚠️ and the hang question becomes: does a browser host
need a fatal-report deadline Node lacks? Settle at PICKUP against the table.

## Acceptance

1. Per host (`packages/runtime-js/tests/fatal-report.test.ts`, isolate
   `node-file.test.ts`, no-COI/COI `node-file-parity` specs), each cell where
   Node exits gives Node's stderr/exit (the missing header under its existing
   pin), or is a declared compat ⚠️ row — never an undeclared hang. → scenario
2. The two cells where Node never exits (`get`/self, `getPrototypeOf`/cause):
   the outcome a passing host shows is the Question's answer (a matched hang
   vs a bounded report); recorded before RED. → scenario
3. A thrown Proxy over an Error with an empty handler prints Node's stack, or
   is a declared ⚠️. → scenario

## Challenge

challenge: 2026-11-23 — finding capture; no premise critic (README §Challenge)
