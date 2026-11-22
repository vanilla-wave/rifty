---
area: runtime-js
status: draft
title: "The isolate guest reports a CJS syntax error or a required ES module as Node does"
created: 2026-11-22
why: in the isolate `await` in a non-async function gives NotImplementedError instead of SyntaxError, and `require` of ESM syntax throws `URLConstructor is not a constructor`
sources: [PR-421-external-review-round-1]
code: [packages/isolate-guest/src/guest/entry.ts, packages/runtime-js/src/internal/posix-file-url.ts]
---

## Context

The guest's ESM-syntax gap claims any SyntaxError whose text looks like ESM; `import.meta.url` needs the guest-visible `URL`, which the isolate replaces with its ceiling. Found by the PR #421 external review (round 1, Node v24.16.0), outside goal
`node-file-entry-parity`; not reproduced by this capture beyond the reviewer's run.

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
