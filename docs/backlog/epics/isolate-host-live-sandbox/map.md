# Map — isolate-host-live-sandbox

## Items

None left to build: the acceptance carrier and `distribution/isolate-host-sandbox-core` landed
on the goal branch (Final+GREEN PASS @ 30c8c1ff1). What still gates leaving draft and CLOSE is in
`## Open questions` (owned outside this branch) — CLOSE runs on the manager's message after the
external review.

## Open questions

- The per-sandbox cap (I6): one number, the codec's `maxBytes` count
  (ADR-0567 refuses before allocating); the isolate limit alone does not hold
  the state (a guest fits 51 MiB of files at limit 64, step 0, capture peaks
  at ~2 × S, ADR-0567 P2) — owner: agent — its default, its relation to
  `memoryLimitMb` (a capture that runs out of isolate memory is the same named
  result, not `memory`), measured on the landed codec.
- Codec cost per run on a small FS and in the consumer realm; the
  consumer's memory per idle sandbox — owner: agent — measure on the landed
  seam (template scale is already measured, see the state-model line).
- State bytes on the consumer → worker wire (JSON + base64 vs binary
  request frames) — owner: agent — measure at the wire wall.
- `require.main === module` is `false` in rifty's program entry (step 0 S3) —
  owner: runtime-js thread (manager) — this goal's PR stays out of ready and
  the goal does not close until its corpus row is green against real Node;
  merge main when it lands.
- Behavior divergences pinned ⚠️ in the carrier (not diagnostic text): work queued when
  `process.exit()` runs still runs and a file it writes is kept; an uncaught throw followed by an
  endless microtask chain ends as `timeout` with its writes rolled back — owner: thread #416 — the
  manager's rule (2026-11-22): "green against Node, or ⚠️ citing the runtime-js item" and "a compat
  row saying the run's files are rolled back"; both are pinned that way, so they no longer gate
  draft; a #416 fix flips their carrier red, then to parity rows.
- The codec seam (`t3/isolate-host-fs-snapshot`) — owner: snapshot thread —
  the manager sends the sha once its shape is stable; build on that branch.

## Out of scope

- The library template (`createSandbox({ template })` → `NotImplementedError('isolate-host.sandbox-template')`).
- Web API shims (`URL`, `structuredClone`, web streams, `AbortController`, `EventTarget`): loud ceilings as in `runCode`; their own ROADMAP direction.
- ESM: an ESM entry or module (`.mjs`, `"type": "module"`, ESM syntax in a typeless `.js`) → `NotImplementedError('isolate-host.esm')` + compat ❌.
- `exec` options `env`, `cwd`, `stdin` → `NotImplementedError('isolate-host.sandbox-exec-<option>')`; shell syntax (the path is one file path, never parsed).
- Keeping a killed run's partial writes (whole-run rollback, compat ⚠️); a host-disk directory model (not built, ADR critic only).
- Text of `node file.js` diagnostics (positions, header, caret, footer, `SyntaxError` shape, `Cannot find module` header): the runtime-js diagnostics goal; pinned ⚠️ here.
- npm publication; RPC transport; per-tenant worker affinity; `process.exit()` from a microtask and the suite flake (neighbour threads).
