---
area: runtime-js
status: active
title: Silent Node divergences — failing-parity-first fixes
created: 2026-06-20
why: Five node: builtins SILENTLY diverge from Node (wrong output/URL or dead option, not a loud throw) — direct Fidelity violation; a wrong answer is worse than NotImplementedError.
user_story: As a dev running real Node code, I want util.inspect/querystring/util.format/import.meta.resolve/writable to match Node, but today they silently return wrong values (NaN, "b+c", literal %c, bad file:// URL) or no-op a declared option — corrupting output with no error
sources: [research/node-parity-gaps-unbacklogged-2026-06-20.md §2/§5/§6, AGENTS.md §Fidelity, ADR-0154]
code: [packages/runtime-js/src/repl/inspect.ts, packages/runtime-js/src/builtins/querystring.ts, packages/runtime-js/src/builtins/util.ts, packages/runtime-js/src/module-loader/esm.ts, packages/io/src/streams/writable.ts]
---

## Context

Each = silent wrong behavior (no throw). Write a RED parity/regression test pinning the wrong output FIRST, then fix.

| # | node-API (+since) | divergence · real-path | anchor |
|---|---|---|---|
| 1 | `util.inspect` (v0.3) | sig `inspect(value,depth=0,seen)` reads 3rd positional as depth → `inspect(obj,{depth:null})` = NaN; `formatString` uses `JSON.stringify` → double quotes vs Node single. Pure-JS in-realm | inspect.ts:12 / :35 |
| 2 | `querystring.parse` (v0.1) | `parse("a=b+c")` → `"b+c"` not `"b c"` — decode skips `+`→space. express/formidable hit it | querystring.ts:42 |
| 3 | `util.format` `%c` (v12) | switch has no `case 'c'`: falls through, keeps literal AND fails to consume arg | util.ts:37 |
| 4 | `import.meta.resolve` (v20.6) | lying inline stub `(s)=>new URL(s,__importMetaUrl).href` → bare `"lodash"`/`"node:fs"` return WRONG `file://` URL. Real resolver exists (loader→resolver.ts) | esm.ts:180 |
| 5 | `writable.writev?` (v0.11) | option DECLARED but used NOWHERE — `drainBuffer` always `writeImpl` per-chunk. Dead type-only placeholder (no-silent-stub) | writable.ts:20 / :244 |

## Options or Next

Parity-first, per-feature promotable: for each, RED parity test pinning current-wrong output (and Node-correct expected) → fix → green. (1)(3) S; (2) S; (4) thread loader resolver (M); (5) make writev real via cork/uncork OR remove the dead option.

Cross-link (FEATURE side owned elsewhere; this item owns the CORRECTNESS bug + parity test): inspect options → util-surface-completions; cork/uncork batching → whatwg-stream-bridge-and-statics; import.meta.resolve real-resolution → process-module-loader-surface.

## Reversibility

REVERSIBLE — recorded in this backlog item.
