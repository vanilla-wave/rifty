---
area: runtime-js
status: draft
title: "In the isolate guest an `unhandledRejection` listener gets the rejected promise and its own reason"
created: 2026-11-22
why: the isolate guest calls `unhandledRejection` listeners with an isolated-vm copy of the reason and `promise` undefined; Node passes the original reason and the promise
sources: [PR-421-external-review-round-1, docs/public/compat/isolate-host.md]
code: [packages/isolate-guest/src/guest/entry.ts, packages/isolate-guest/src/contract.ts, packages/isolate-host/src/child/main.ts]
---

## Context

Found by the PR #421 external review (round 1), outside goal
`node-file-entry-parity`; declared ⚠️ in compat isolate-host.md
"`unhandledRejection` listener arguments", no backlog item until now.
Reproduced by this capture (Node v24.16.0 vs `runCode` from
`packages/isolate-host/dist`, built 2026-11-22 21:14):

```
const e = new Error("x"); const q = Promise.reject(e);
process.on("unhandledRejection", (r, p) => console.log(r === e, p === q, p instanceof Promise))
node -e → "true true true", exit 0      isolate → "false false false", exit 0
```

Cause (read): isolated-vm reports the rejection to the embedder outside the
isolate; the guest contract `rejection(reason)` (`contract.ts`) carries a copy
of the reason only, and `entry.ts` calls
`handleRealmUnhandledRejection(reason, undefined)`. The promise and the
reason's identity never cross back. Fault class: lossy boundary copy — the
listener sees values that are not the program's.

## Acceptance

1. Isolate parity (`packages/isolate-host/tests`, oracle live `node -e`): the
   program above prints `true true true`; a non-`Error` reason arrives as
   itself; the compat row becomes ✅ or names what stays. → scenario

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
