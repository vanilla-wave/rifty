# ADR 0024: File-size budget

**Status:** Superseded by ADR-0033 (2026-05-26).

Status: Enforcement implemented (2026-05-24) — `tools/checks/file-budget.mjs`, wired into `pnpm check:budget` + CI lint job. WASI decomposition landed (2026-05-24). Exception list shrunk on 2026-05-25 (ADR-0012 split `runtime-js/builtins/{stream,buffer}.ts` into thin shims).
Date: 2026-05

## Context

CLAUDE.md's hard rules include "files under ~300 lines. Split when growing larger." Several files have drifted past the budget:

- `packages/runtime-wasi/src/wasi.ts` — ~370 lines, monolithic syscall switch.
- `packages/runtime-js/src/module-loader/resolver.ts` — ~372 lines.
- `packages/runtime-js/src/module-loader/esm-ast-walker.ts` — ~403 lines.
- `packages/runtime-js/src/builtins/stream.ts` — ~449 lines.

REVIEW_ACTIONS entry A-039 calls them out. A single sweep that splits all four is risk-laden: `wasi.ts` lacks the test coverage needed to safely decompose, and the other three are tightly internally coherent (one resolver, one walker, one stream barrel).

## Decision

Adopt a graduated enforcement policy.

- `packages/runtime-wasi/src/wasi.ts` gets a structural split deferred to M11. Target layout: `packages/runtime-wasi/src/syscalls/{fd,path,proc}.ts` (one file per syscall family); `wasi.ts` reduces to the orchestration entry point (< 200 lines). The split blocks on better WASI test coverage being in place first.
- `resolver.ts`, `esm-ast-walker.ts`, `stream.ts` are documented as accepted exceptions to the 300-line budget in this ADR. They are internally cohesive (one resolver, one scope-aware walker, one stream-barrel re-export) and splitting them for a line count alone risks fragmenting a working surface. The exception list is reviewed each milestone; entries are removed when the file naturally shrinks.
- Biome's file-line cap (if available in the installed version) is configured as a soft warning at 300 lines. If Biome does not support file-line caps, the rule remains documentary; reviewers enforce by eye.

## Consequences

- Future drift past 300 lines surfaces in lint output (Biome warning) or in PR review.
- The WASI split, once it lands, unblocks easier addition of new syscalls without bloating the central switch.
- Negative: a documented exception list is still an exception. Reviewers must check the list on each PR that touches an exempt file.
- Negative: deferring the WASI split means the file stays oversize through M11; new WASI syscalls added in the meantime add to the rewrite burden.
- Follow-up: M11 — WASI decomposition; revisit exception list at the end of each milestone.

## Acceptance criteria for the deferred implementation

- [x] WASI split lands as `packages/runtime-wasi/src/syscalls/{env,fd,path,proc,clock,shared}.ts` with `wasi.ts` reduced to orchestration (129 lines).
- [ ] WASI test coverage gains at least one parity case per syscall family — followup; existing 7 conformance tests still cover env/fd/path/proc end-to-end via real `_start` and hand-crafted wasm.
- [x] Biome configuration is checked; v1.9.4 has no file-line cap, so enforcement lives in `tools/checks/file-budget.mjs` (LIMIT = 300; offenders must be in the allow-list there + documented below).
- [ ] The exception list in this ADR is updated when entries leave it (file shrinks naturally) or join it (new exception accepted by reviewer).

## Current documented exceptions (as of 2026-05-24)

These files exceed the 300-line budget by design or because their split is
deferred. Adding new entries requires a paragraph here explaining why. Line
counts are `wc -l` at the date of this revision and will drift; the
authoritative allow-list is `EXCEPTIONS` in `tools/checks/file-budget.mjs`.

Originally enumerated in this ADR:

- `packages/runtime-js/src/module-loader/resolver.ts` — 443 lines. Single Node-style resolver algorithm; further splitting fragments the traversal logic across files.
- `packages/runtime-js/src/module-loader/esm-ast-walker.ts` — 408 lines. Single scope-aware AST-walker pass; the alternative is two passes over the same tree.
- ~~`packages/runtime-js/src/builtins/stream.ts`~~ — **removed 2026-05-25.** ADR-0012 moved the stream classes into `@riftydev/io/src/streams/{readable,writable,duplex,transform,pass-through,pipeline}.ts`; the runtime-js file is now a ~30-line re-export shim.

Additional drift discovered when the budget check was wired up (2026-05-24):

- ~~`packages/runtime-js/src/builtins/buffer.ts`~~ — **removed 2026-05-25.** ADR-0012 moved Buffer into `@riftydev/io/src/buffer{,-codec,-methods}.ts` (≤ 260 lines each); the runtime-js file is now a ~10-line re-export shim.
- `packages/runtime-js/src/builtins/crypto.ts` — 534 lines. Pulls together `createHash`, `randomBytes`, and the Web Crypto bridges; revisit after M10 once we know which surfaces real packages actually exercise.
- `packages/runtime-js/src/builtins/fs.ts` — 445 lines. Mirrors Node's flat `fs` module; splitting into `fs/sync.ts` + `fs/promises.ts` is a candidate refactor when the file grows further.
- `packages/runtime-js/src/module-loader/esm-ast.ts` — 303 lines. One line over the limit; will likely fall out of the list with the next small change.
