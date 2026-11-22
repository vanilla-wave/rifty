# Map — isolate-host-live-sandbox

## Items

1. `distribution/isolate-host-sandbox-acceptance` — **acceptance carrier** —
   the `## User scenario` as tests vs real `node <path>` sequences;
   committed RED (`it.fails`).
2. `distribution/isolate-host-sandbox-core` — **the sandbox** — the wall the
   carrier hits first; carries the Fault matrix rows below the scenario
   level — after the codec seam (#418).
Wall hypotheses the carrier is expected to hit (units only when the run hits
them): the guest's `node <path>` entry beside `run(code)` (ESM entry as a loud
gap); the snapshot goal's codec seam — restore before the run, snapshot after
it, decode in the consumer realm; the wire carrying state bytes both ways
(consumer → worker today JSON lines); the consumer's `Sandbox` (one operation
at a time, destroy, host file ops over the decoded state, limits); bytes
crossing the bridge as their view's range (step 0 S2); the corpus of run
sequences against `node <path>` (I2); ADR, README, compat, trust-model,
ROADMAP M14 (I8).

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
