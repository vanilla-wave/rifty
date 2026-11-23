---
area: runtime-js
status: draft
title: "In the isolate guest `await` inside a non-async function fails with Node's SyntaxError"
created: 2026-11-22
why: the isolate guest turns `function f(){ await x }` into `NotImplementedError('isolate-host.node-eval-esm')`; Node reports a SyntaxError at the line
user_story: As a service running model-written JS in the isolate host, I want a misplaced `await` to report Node's SyntaxError with its line and caret so the model fixes its code, but today the error says ESM is unsupported and tells it to use require()
sources: [PR-421-external-review-round-1, docs/public/compat/isolate-host.md]
code: [packages/isolate-guest/src/guest/entry.ts]
---

## Context

Found by the PR #421 external review (round 1); manager decision: outside the scope of
ADR-0571, own draft. Reproduced by this capture (Node v24.16.0
vs `runCode` from `packages/isolate-host/dist`, built 2026-11-22 21:14):

```
$ node -e 'function f(){ await x }'; echo $?
[eval]:1
function f(){ await x }
              ^^^^^
await isn't allowed in non-async function

SyntaxError: await is only valid in async functions and the top level bodies of modules
    at makeContextifyScript (node:internal/vm:194:14)
    …
Node.js v24.16.0
1
runCode('function f(){ await x }') → exit 1, stderr
NotImplementedError: Not implemented: isolate-host.node-eval-esm (Node runs -e input with ESM syntax as a module; this host evaluates CommonJS only — use require()) { feature: 'isolate-host.node-eval-esm' }
```

Cause (read): `entry.ts` `esmGapOf` maps every SyntaxError whose message is in
`ESM_SYNTAX` to the ESM gap. V8 gives the same message for top-level `await`
(Node: re-runs as ESM — the declared gap, compat row "ESM syntax in `-e`") and
for `await` in a non-async function (Node: SyntaxError, no ESM run). The message
alone cannot tell them apart. A required file with the same body gives the same
`NotImplementedError … use require()` (measured 2026-11-23, PR #421 HEAD; before the
PR too): its compile error carries V8's message and reaches `esmGapOf` as well.

Fault class: `provenance-lie` — the error claims a cause (unsupported ESM) the
input does not have; the reader is sent to the wrong fix.

## Acceptance

1. Isolate parity (`packages/isolate-host/tests`, oracle live `node -e`):
   `function f(){ await x }` gives Node's SyntaxError report and exit 1 (under
   the declared `node:*` frame projection); top-level `await x` keeps the
   declared `isolate-host.node-eval-esm` gap. → scenario

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
