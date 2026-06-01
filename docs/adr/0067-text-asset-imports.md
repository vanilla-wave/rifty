# ADR 0067: text-asset imports (`.txt` / `.sql` / `.md` / `.prompt` → file contents)

Status: Accepted (opencode facade M12)
Date: 2026-06-01

## Context

The opencode GRAPH-LOAD smoke walled on
`/workspace/packages/opencode/src/agent/generate.txt` being fed to `new Function`
(`Unexpected identifier 'are'` — prose parsed as JavaScript). opencode imports
non-JS assets as **text**:

```ts
// packages/opencode/src/agent/agent.ts
import PROMPT_GENERATE from "./generate.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
// …37 `.txt`, 8 `.sql`, 1 `.md`, 1 `.prompt` across the source tree
```

This is the esbuild **`text` loader** / Bun default: `import s from "./f.txt"`
binds the default export to the file's contents (a string). opencode is built
under Bun, which applies text loaders to these extensions, so the source relies on
it. rifty's loader had no notion of asset imports — it classified the resolved
`.txt` as CJS (non-`type:module` default) and executed its prose as JavaScript.

**Why Node doesn't do this.** Node has no built-in text-asset import (you would
need an experimental loader / import attributes). So, like ADR-0053 (`.ts`
resolution) and ADR-0052 (the TS transform), this is a deliberate, scoped
deviation that goes beyond vanilla Node to run a real Bun/esbuild TS project. It is
made under ADR-0063/0064 standing authority — the need is verified by the live
smoke wall (an inflection, not a stop).

## Decision

- **D1 — A fixed set of extensions imports as TEXT.**
  `TEXT_EXTENSIONS = ['.txt', '.sql', '.md', '.prompt']` (resolver.ts) classify as
  a new `ModuleKind` value `'text'`. These are the asset extensions opencode
  imports; the set mirrors esbuild's `text` loader convention. (`.json` keeps its
  existing dedicated `'json'` kind — structured parse, not raw text.)

- **D2 — The module value IS the raw file contents string.**
  `executeCjs` returns `resolved.source` (the file bytes decoded as UTF-8 text) as
  the CJS `module.exports`. An ESM `import x from "./f.txt"` routes through the
  CJS-interop path, and `wrapCjsAsEsmNamespace` (which already maps a non-object
  CJS export to `default`) exposes the string as the **default export** — matching
  esbuild/Bun. `require("./f.txt")` returns the string directly.

- **D3 — Only on an explicit-extension import; not added to extension fallback.**
  Text extensions are NOT added to `DEFAULT_EXTENSIONS`, so a bare extensionless
  specifier never resolves to a `.txt`/`.sql`/`.md`/`.prompt`. The capability fires
  only when the import names the extension (`"./f.txt"`), which Node would
  `MODULE_NOT_FOUND` anyway — so this is a pure additive capability, not a parity
  regression for any existing JS package.

- **D4 — Binary assets (`.wasm`, etc.) are OUT of scope.**
  Text loaders cover UTF-8 text only. A `.wasm` import (1 in opencode, tree-sitter,
  off the boot path) needs a binary/URL loader and is deferred — if it walls, it
  gets its own decision. No silent stub: a `.wasm` reaching the CJS path still
  loud-fails (it is not in `TEXT_EXTENSIONS`).

## Consequences

- `resolver.ts`: `ModuleKind` gains `'text'`; `TEXT_EXTENSIONS` const; `detectKind`
  returns `'text'` for those extensions. `cjs.ts`: a `'text'` branch returns the
  raw source as `module.exports`. No signature changes; additive.
- Behaviour change for ALL consumers of `@rifty/runtime-js`: an explicit
  `import … from "./x.txt"` (etc.) now resolves to the file's text instead of
  `MODULE_NOT_FOUND`/parse-error. Guarded to explicit-extension imports only (D3).
- Unblocks opencode's 37 `.txt` prompt imports + `.sql`/`.md`/`.prompt` assets.
- Conformance: `tests/conformance/modules/text-asset-import.test.ts`. This is
  rifty-specific behaviour — vanilla Node has no native text-asset import to diff
  against — so it is a conformance case, not a parity case (same rationale as the
  ADR-0066 path-alias cases).

## Reversibility

IRREVERSIBLE (reversibility rule 1 — adds a public `ModuleKind` value and changes
observable cross-package resolver/loader behaviour; deviates from ADR-0004's Node
algorithm). No new external dependency. Recorded as a ratified ADR per ADR-0063/0064
with the need verified by the live smoke wall. ADR-0004 is not superseded — its
resolution algorithm stands; this adds an asset-import kind alongside it, the same
way ADR-0053 added `.ts` resolution.

The REVERSIBLE follow-on — making the text-extension set CONFIGURABLE via
`ModuleLoaderOptions` (per-project loader maps, like esbuild) instead of a fixed
list, and adding a binary/`.wasm` loader — is deferred under `Q-2026-06-01-306`.

## References

- ADR-0052 (TS-on-import transform hook) + ADR-0053 (`.ts`/`.tsx` resolvable) — the
  prior deliberate Node deviations this extends the pattern of.
- ADR-0004 (the Node resolution algorithm; text imports are an additive,
  explicit-extension-only deviation, not a supersession).
- ADR-0063/0064 (record-and-continue; the live smoke wall is a verified need).
- `docs/opencode/HANDOFF.md` (the `generate.txt` wall this clears).
- `Q-2026-06-01-306` (deferred: configurable loader map + binary/`.wasm` loader).
