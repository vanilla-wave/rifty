---
area: runtime-js
status: draft
title: "An error's `stack` read by guest code in the isolate shows no rifty-runtime frame"
created: 2026-11-22
why: `console.error(err)` / `err.stack` in the isolate guest prints `rifty-isolate-guest.js:<line>` frames of rifty's runtime; Node prints the user frame and its own `node:` frames
sources: [PR-421-external-review-round-1]
code: [packages/isolate-guest/src/guest/entry.ts, packages/runtime-js/src/builtins/node-entry.ts]
---

## Context

Found by the PR #421 external review (round 1), not in the corpus of
ADR-0571 (its frame contract covers the fatal report only; that report
already drops runtime frames — compat process.md "Fatal error stderr bytes").
Reproduced by this capture (Node v24.16.0 vs `runCode` from
`packages/isolate-host/dist`, built 2026-11-22 21:14),
`console.error(new Error("boom"))`, exit 0 in both:

```
node -e:                                   isolate guest:
Error: boom                                Error: boom
    at [eval]:1:15                             at eval ([eval]:1:15)
    at runScriptInThisContext (node:internal/vm:219:10)      at eval (<anonymous>)
    at node:internal/process/execution:451:12                at Object.runNodeEvalScript (rifty-isolate-guest.js:134167:16)
    at [eval]-wrapper:6:24                                   at Object.run (rifty-isolate-guest.js:134181:29)
    … (4 more node:internal frames)                          at runNodeEntry (rifty-isolate-guest.js:134276:12)
                                                             at rifty-isolate-guest.js:134530:23
                                                             at new Promise (<anonymous>)
                                                             at run (rifty-isolate-guest.js:134526:12)
```

Two gaps: rifty's runtime frames (bundle name and line leak the host; they
also spend the `Error.stackTraceLimit` budget), and the user frame named
`at eval (…)` / `at eval (<anonymous>)` where Node has `at [eval]:1:15`.
Node's `node:internal` frames have no rifty counterpart (forging them is a
rejected route, ADR-0571). Other hosts (no-COI SDK, COI Workbench) not
checked by this capture. No compat row yet. Fault class: `sibling-drift`
between the fatal-report frame projection and the guest-visible `stack`.

Open fork — owner: agent at PICKUP: which reader gets Node's frames —
`err.stack` itself (incl. `Error.captureStackTrace`, `prepareStackTrace`
callsites) or only printers (`console`, `util.inspect`; leaves `e.stack`
lying). Settles by Node's observable `stack` + a realm-wide hook's cost
(ADR-0450 owns `Error.prepareStackTrace`).

## Acceptance

1. Isolate parity (`packages/isolate-host/tests`, oracle live `node -e`):
   `console.error(err)` and `console.log(err.stack)` equal Node's under
   ADR-0571's P1 projection (Node's `node:*` frames deleted) — user frame `at [eval]:1:15`, no
   `rifty-isolate-guest.js` frame. → scenario

External review round 5 of PR #421 (2026-11-23, not reproduced here): in the
isolate `console.log(err)` also loses the error's own props (`code: 'E1'`)
next to the rifty frames — the most common way model-written code prints an
error. Priority: high among the isolate drafts (the fatal report already shows
both correctly; `console.log` does not reuse it).

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
