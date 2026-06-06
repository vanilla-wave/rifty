# ADR 0024: File-size budget

**Status:** Superseded by ADR-0033 (2026-05-26).

Status: Enforcement implemented (2026-05-24) — `tools/checks/file-budget.mjs`, wired into `pnpm check:budget` + CI lint job. WASI decomposition landed (2026-05-24). Exception list shrunk 2026-05-25 (ADR-0012 split `runtime-js/builtins/{stream,buffer}.ts` into thin shims).
Date: 2026-05

## Context

CLAUDE.md rule: files under ~300 lines, split when larger. Four files drifted past budget (flagged by REVIEW_ACTIONS A-039):

- `packages/runtime-wasi/src/wasi.ts` — ~370 lines, monolithic syscall switch.
- `packages/runtime-js/src/module-loader/resolver.ts` — ~372 lines.
- `packages/runtime-js/src/module-loader/esm-ast-walker.ts` — ~403 lines.
- `packages/runtime-js/src/builtins/stream.ts` — ~449 lines.

A single sweep splitting all four is risky: `wasi.ts` lacks test coverage to decompose safely; the other three are internally cohesive (one resolver, one walker, one stream barrel).

## Decision

Graduated enforcement policy:

- `wasi.ts` — structural split deferred to M11, blocked on better WASI test coverage first. Target: `packages/runtime-wasi/src/syscalls/{fd,path,proc}.ts` (one file per syscall family); `wasi.ts` reduced to orchestration entry point (< 200 lines).
- `resolver.ts`, `esm-ast-walker.ts`, `stream.ts` — accepted exceptions documented here. Internally cohesive (one resolver, one scope-aware walker, one stream-barrel re-export); splitting for line count alone fragments a working surface. List reviewed each milestone; entries removed when files naturally shrink.
- Biome file-line cap configured as soft warning at 300 lines if supported; otherwise rule is documentary, reviewers enforce by eye.

## Consequences

- Future drift surfaces in lint output (Biome warning) or PR review.
- WASI split, once landed, unblocks adding new syscalls without bloating the central switch.
- Negative: a documented exception list is still an exception — reviewers must check it on each PR touching an exempt file.
- Negative: deferring the WASI split keeps the file oversize through M11; syscalls added meanwhile add to the rewrite burden.
- Follow-up: M11 WASI decomposition; revisit exception list at end of each milestone.

## Acceptance criteria for the deferred implementation

- [x] WASI split lands as `packages/runtime-wasi/src/syscalls/{env,fd,path,proc,clock,shared}.ts`, `wasi.ts` reduced to orchestration (129 lines).
- [ ] WASI test coverage gains ≥1 parity case per syscall family — followup; existing 7 conformance tests cover env/fd/path/proc end-to-end via real `_start` + hand-crafted wasm.
- [x] Biome config checked; v1.9.4 has no file-line cap, so enforcement lives in `tools/checks/file-budget.mjs` (LIMIT = 300; offenders must be in its allow-list + documented below).
- [ ] Exception list updated when entries leave (file shrinks) or join (new exception accepted by reviewer).

## Current documented exceptions (as of 2026-05-24)

Files exceeding the 300-line budget by design or because their split is deferred. New entries need a paragraph explaining why. Line counts are `wc -l` at this revision and drift; authoritative allow-list is `EXCEPTIONS` in `tools/checks/file-budget.mjs`.

Originally enumerated here:

- `packages/runtime-js/src/module-loader/resolver.ts` — 443 lines. Single Node-style resolver; splitting fragments traversal logic.
- `packages/runtime-js/src/module-loader/esm-ast-walker.ts` — 408 lines. Single scope-aware AST-walker pass; alternative is two passes over the same tree.
- ~~`packages/runtime-js/src/builtins/stream.ts`~~ — **removed 2026-05-25.** ADR-0012 moved stream classes into `@riftydev/io/src/streams/{readable,writable,duplex,transform,pass-through,pipeline}.ts`; runtime-js file is now a ~30-line re-export shim.

Additional drift found when the budget check was wired up (2026-05-24):

- ~~`packages/runtime-js/src/builtins/buffer.ts`~~ — **removed 2026-05-25.** ADR-0012 moved Buffer into `@riftydev/io/src/buffer{,-codec,-methods}.ts` (≤ 260 lines each); runtime-js file is now a ~10-line re-export shim.
- `packages/runtime-js/src/builtins/crypto.ts` — 534 lines. Bundles `createHash`, `randomBytes`, Web Crypto bridges; revisit after M10 once real-package surfaces are known.
- `packages/runtime-js/src/builtins/fs.ts` — 445 lines. Mirrors Node's flat `fs`; splitting into `fs/sync.ts` + `fs/promises.ts` is a candidate when it grows further.
- `packages/runtime-js/src/module-loader/esm-ast.ts` — 303 lines. One line over; will likely drop off the list with the next small change.
