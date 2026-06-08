# ADR 0068: `with { type: "file" }` file-loader import attribute (asset → path)

Status: Accepted (opencode facade M12)
Date: 2026-06-01

## Context

opencode's GRAPH-LOAD smoke walled on `@silvia-odwyer/photon-node/photon_rs_bg.wasm`: rifty compiled the `.wasm` as a CJS module (binary bytes → `new Function` → `Invalid or unexpected token`). The importer is `packages/opencode/src/image/image.ts`:

```ts
import photonWasm from "@silvia-odwyer/photon-node/photon_rs_bg.wasm" with { type: "file" }
// …later: path.isAbsolute(photonWasm) ? photonWasm : fileURLToPath(new URL(photonWasm, import.meta.url))
```

This is the esbuild/Bun **`file` loader** attribute: `import x from "spec" with { type: "file" }` binds `x` to the asset's **path** (string) so code can read/locate it instead of loading it as a JS module. opencode uses it to hand photon the wasm path; photon's JS API itself loads lazily via a *dynamic* `import("@silvia-odwyer/photon-node")`, off the static graph. rifty ignored the attribute and tried to load the `.wasm` as a module. The attribute survives the esbuild type-strip, and acorn (`ecmaVersion: 'latest'`) parses it as `node.attributes`, so the transformer can key off it.

Deliberate Bun/esbuild deviation beyond vanilla Node (whose import attributes standardise only `type: "json"`), same family as ADR-0067 (text imports) / ADR-0053 (`.ts`). Made under ADR-0063/0064 standing authority, need verified by the live smoke wall.

## Decision

- **D1 — `with { type: "file" }` binds the local to the resolved absolute path.** The transformer (`esm-ast.ts`) detects the `file` attribute on an `ImportDeclaration` (`node.attributes`, falling back to `node.assertions`) and emits `const <local> = __assetPath("<spec>")` for the default specifier. A namespace specifier binds to `{ default: <path> }`; named specifiers are meaningless for a file asset and are dropped. `__assetPath` (injected into the ESM factory in `esm.ts`) resolves the spec to its file id via `deps.resolve(spec, from, esm).id`.

- **D2 — A file-attribute import is NOT a module load.** Its specifier is excluded from `staticImports`, so the asset is never preloaded, evaluated, transformed, or compiled — it may be binary (a `.wasm`). Only its path is computed. This lets opencode's `.wasm` asset path resolve without the binary ever reaching `new Function`.

- **D3 — Any extension; keyed on the attribute, not the extension.** The mechanism is the explicit `type: "file"` attribute, so it works for any asset extension and does not collide with a future ESM-wasm/binary *module* loader (deferred, `Q-2026-06-01-306`) that would handle an attribute-less `import … from "./x.wasm"`.

## Consequences

- `esm-ast.ts`: adds `isFileAttributeImport` + `handleFileImport`; the top-level import loop routes file-attribute imports to the path binding and away from `staticImports`. `esm.ts`: a 9th factory parameter `__assetPath`.
- Behaviour change for `@riftydev/runtime-js` consumers: `import … with { type: "file" }` now yields the asset path instead of failing to load the asset as a module. Attribute-less imports unchanged.
- Unblocks opencode's `photon_rs_bg.wasm` path import (and any future `type: "file"` asset import). photon's actual wasm functionality stays a lazy/dynamic concern, off the boot path.
- Conformance: `tests/conformance/modules/file-import-attribute.test.ts`. Like the ADR-0066/0067 cases, vanilla Node has no `type: "file"`, so this is a conformance case, not a parity case.

## Reversibility

IRREVERSIBLE (rule 1 — observable cross-package transformer/loader behaviour; deviates from ADR-0004 / standard import-attribute semantics). No new external dependency. Recorded per ADR-0063/0064, need verified by the live smoke wall. The attribute-less ESM-wasm/binary *module* loader remains deferred (`Q-2026-06-01-306`).

## References

- ADR-0067 (text-asset imports) + ADR-0053 (`.ts`) / ADR-0052 (TS transform) — the asset/non-Node-import family this extends.
- ADR-0004 (Node resolution; additive, attribute-gated deviation).
- ADR-0063/0064 (record-and-continue; verified need).
- `docs/opencode/HANDOFF.md` (the `photon_rs_bg.wasm` wall this clears).
- `Q-2026-06-01-306` (deferred binary/`.wasm` *module* loader).
