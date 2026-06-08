# ADR 0067: text-asset imports (`.txt` / `.sql` / `.md` / `.prompt` → file contents)

Status: Accepted (opencode facade M12)
Date: 2026-06-01

## Context

opencode imports non-JS assets as **text** (esbuild `text` loader / Bun default: `import s from "./f.txt"` binds the default export to the file's string contents):

```ts
// packages/opencode/src/agent/agent.ts
import PROMPT_GENERATE from "./generate.txt"
// …37 `.txt`, 8 `.sql`, 1 `.md`, 1 `.prompt` across the tree
```

rifty's loader had no asset-import notion: it classified resolved `.txt` as CJS and ran its prose as JS — the GRAPH-LOAD smoke walled on `/workspace/packages/opencode/src/agent/generate.txt` fed to `new Function` (`Unexpected identifier 'are'`).

Node has no built-in text-asset import (would need an experimental loader / import attributes). Like ADR-0053 (`.ts` resolution) and ADR-0052 (TS transform), this is a deliberate, scoped deviation beyond vanilla Node to run a real Bun/esbuild TS project, made under ADR-0063/0064 standing authority — need verified by the live smoke wall (an inflection, not a stop).

## Decision

- **D1 — Fixed extension set imports as TEXT.** `TEXT_EXTENSIONS = ['.txt', '.sql', '.md', '.prompt']` (resolver.ts) classify as a new `ModuleKind` value `'text'`. Mirrors esbuild's `text` loader convention. `.json` keeps its dedicated `'json'` kind (structured parse, not raw text).
- **D2 — Module value IS the raw file contents string.** `executeCjs` returns `resolved.source` (UTF-8-decoded bytes) as CJS `module.exports`. `import x from "./f.txt"` routes through CJS-interop; `wrapCjsAsEsmNamespace` (already maps non-object CJS export → `default`) exposes the string as **default export**, matching esbuild/Bun. `require("./f.txt")` returns the string directly.
- **D3 — Explicit-extension imports only; NOT in extension fallback.** Text extensions not added to `DEFAULT_EXTENSIONS`, so a bare extensionless specifier never resolves to them. Fires only on a named extension (`"./f.txt"`), which Node would `MODULE_NOT_FOUND` anyway — pure additive capability, no parity regression for existing JS packages.
- **D4 — Binary assets (`.wasm`, etc.) OUT of scope.** Text loaders cover UTF-8 only. The 1 `.wasm` import (tree-sitter, off boot path) needs a binary/URL loader and is deferred. No silent stub: a `.wasm` reaching the CJS path still loud-fails (not in `TEXT_EXTENSIONS`).

## Consequences

- `resolver.ts`: `ModuleKind` gains `'text'`; new `TEXT_EXTENSIONS` const; `detectKind` returns `'text'` for them. `cjs.ts`: a `'text'` branch returns raw source as `module.exports`. Additive, no signature changes.
- Behaviour change for ALL `@riftydev/runtime-js` consumers: explicit `import … from "./x.txt"` now resolves to file text instead of `MODULE_NOT_FOUND`/parse-error. Guarded to explicit-extension imports (D3).
- Unblocks opencode's 37 `.txt` prompt imports + `.sql`/`.md`/`.prompt` assets.
- Conformance: `tests/conformance/modules/text-asset-import.test.ts`. rifty-specific (no native Node behaviour to diff), so a conformance not parity case — same rationale as ADR-0066's path-alias cases.

## Reversibility

IRREVERSIBLE (rule 1 — adds a public `ModuleKind` value, changes cross-package resolver/loader behaviour, deviates from ADR-0004's Node algorithm). No new external dependency. Ratified per ADR-0063/0064, need verified by the live smoke wall. ADR-0004 is NOT superseded — its resolution algorithm stands; this adds an asset-import kind alongside it, as ADR-0053 added `.ts` resolution.

REVERSIBLE follow-on, deferred under `Q-2026-06-01-306`: make the text-extension set CONFIGURABLE via `ModuleLoaderOptions` (per-project loader maps, like esbuild) instead of fixed, plus a binary/`.wasm` loader.

## References

- ADR-0052 (TS-on-import transform hook) + ADR-0053 (`.ts`/`.tsx` resolvable) — the prior Node deviations this extends.
- ADR-0004 (Node resolution algorithm; text imports are additive, explicit-extension-only, not a supersession).
- ADR-0063/0064 (record-and-continue; the live smoke wall is a verified need).
- `docs/opencode/HANDOFF.md` (the `generate.txt` wall this clears).
- `Q-2026-06-01-306` (deferred: configurable loader map + binary/`.wasm` loader).
