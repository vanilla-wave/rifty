---
area: toolchain-build
status: active
title: ts-esm parity always runs Node side through full tsx transform (vs native strip-only)
created: 2026-06-08
why: parity harness uses tsx full-transform so enum/param-properties lower apples-to-apples; no longer exercises Node's native strip-only path — provisional, awaiting review
sources: [ADR-0052, ROADMAP M11]
code: [tools/node-parity-runner/src/run-in-node.ts:81, tools/node-parity-runner/src/types.ts:38]
---
## Context
Gold `.ts` parity case (`ts-graph-cross-file.case.ts`) exports an `enum` — needs runtime codegen. Node v24's `--experimental-strip-types` (prior `ts-esm` reference on Node>=23) is strip-only: throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on enum/param-properties/runtime-namespace. So Node strip-only diverges from rifty on a *Node limitation*, not a rifty behaviour — wrong reference for full-transform-vs-full-transform parity. TODO(backlog: toolchain-build/ts-esm-parity-node-reference) at the two marker sites above.
## Options / Next
Chosen (A): `ts-esm` Node side ALWAYS runs through full TS transform (vendored `tsx`), any Node major — apples-to-apples, both lower enum identically; `tsx` already a devDep (was the `<23` fallback); `ts-strip-smoke` stays green. Trade-off: no longer exercises Node's native strip-only path (not the contract under test). Alt B (keep strip-only, forbid codegen TS in cases): can't host the gold enum at all. Next: human confirm → promote to ADR via `pnpm adr:new toolchain-build` (manual) (clears the two TODO(backlog: toolchain-build/ts-esm-parity-node-reference) markers).
## Reversibility
REVERSIBLE. No package public API — `run-in-node.ts`/`types.ts` are a `tools/` harness, no `src/index.ts` change. Revert <20 lines, 2 files (restore the `NODE_MAJOR < 23` branch + TSDoc). No new dep (tsx pre-existing). Review at the next milestone DoD.
