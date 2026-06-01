# ADR 0068: `with { type: "file" }` file-loader import attribute (asset → path)

Status: Accepted (opencode facade M12)
Date: 2026-06-01

## Context

The opencode GRAPH-LOAD smoke walled on
`@silvia-odwyer/photon-node/photon_rs_bg.wasm` being compiled as a CJS module
(binary bytes → `new Function` → `Invalid or unexpected token`). The importer is
`packages/opencode/src/image/image.ts`:

```ts
import photonWasm from "@silvia-odwyer/photon-node/photon_rs_bg.wasm" with { type: "file" }
// …later: path.isAbsolute(photonWasm) ? photonWasm : fileURLToPath(new URL(photonWasm, import.meta.url))
```

This is the esbuild/Bun **`file` loader** import attribute: `import x from "spec"
with { type: "file" }` resolves `x` to the asset's **path** (a string), so the
code can read/locate the file rather than load it as a JS module. opencode uses it
to hand photon the wasm path (photon's JS API is loaded lazily via a *dynamic*
`import("@silvia-odwyer/photon-node")`, off the static graph). rifty ignored the
attribute and tried to load the `.wasm` as a module. The attribute **survives**
the esbuild type-strip and acorn (`ecmaVersion: 'latest'`) parses it as
`node.attributes`, so the transformer can key off it.

This is a deliberate Bun/esbuild deviation beyond vanilla Node (whose import
attributes only standardise `type: "json"`), in the same family as ADR-0067 (text
imports) / ADR-0053 (`.ts`). Made under ADR-0063/0064 standing authority with the
need verified by the live smoke wall.

## Decision

- **D1 — `with { type: "file" }` binds the local to the resolved absolute path.**
  The transformer (`esm-ast.ts`) detects the `file` import attribute on an
  `ImportDeclaration` (`node.attributes`, falling back to `node.assertions`) and
  emits `const <local> = __assetPath("<spec>")` for the default specifier (a
  namespace specifier binds to `{ default: <path> }`; named specifiers are
  meaningless for a file asset and are dropped). `__assetPath` is a helper injected
  into the ESM factory (`esm.ts`) that resolves the specifier to its file id via
  the resolver — `deps.resolve(spec, from, esm).id`.

- **D2 — A file-attribute import is NOT a module load.** Its specifier is
  deliberately excluded from `staticImports`, so the asset is never preloaded,
  evaluated, transformed, or compiled — it may be binary (a `.wasm`). Only its path
  is computed. This is what lets opencode's `.wasm` asset path resolve without the
  binary ever reaching `new Function`.

- **D3 — Any extension; keyed on the attribute, not the extension.** The mechanism
  is the explicit `type: "file"` attribute, so it is correct for any asset
  extension and does not collide with a future ESM-wasm/binary *module* loader
  (deferred, `Q-2026-06-01-306`) which would handle an attribute-less
  `import … from "./x.wasm"`.

## Consequences

- `esm-ast.ts`: `isFileAttributeImport` + `handleFileImport`; the top-level import
  loop routes file-attribute imports to the path binding and away from
  `staticImports`. `esm.ts`: a 9th factory parameter `__assetPath`.
- Behaviour change for consumers of `@rifty/runtime-js`: an `import … with { type:
  "file" }` now yields the asset path instead of attempting (and failing) to load
  the asset as a module. Attribute-less imports are unchanged.
- Unblocks opencode's `photon_rs_bg.wasm` path import (and any future
  `type: "file"` asset import). photon's actual wasm functionality remains a
  lazy/dynamic concern, off the boot path.
- Conformance: `tests/conformance/modules/file-import-attribute.test.ts`. Like the
  ADR-0066/0067 cases this is rifty-specific (vanilla Node has no `type: "file"`),
  so it is a conformance case, not a parity case.

## Reversibility

IRREVERSIBLE (reversibility rule 1 — observable cross-package transformer/loader
behaviour; deviates from ADR-0004 / standard import-attribute semantics). No new
external dependency. Recorded per ADR-0063/0064 with the need verified by the live
smoke wall. The attribute-less ESM-wasm/binary *module* loader remains deferred
(`Q-2026-06-01-306`).

## References

- ADR-0067 (text-asset imports) + ADR-0053 (`.ts`) / ADR-0052 (TS transform) — the
  asset-/non-Node-import family this extends.
- ADR-0004 (Node resolution; this is an additive, attribute-gated deviation).
- ADR-0063/0064 (record-and-continue; verified need).
- `docs/opencode/HANDOFF.md` (the `photon_rs_bg.wasm` wall this clears).
- `Q-2026-06-01-306` (deferred binary/`.wasm` *module* loader).
