# Incompatible packages

rifty runs **JavaScript + WASI WebAssembly only**. It can never load native
`.node` addons (node-gyp) or execute native compiled binaries (ELF / Mach-O /
PE). This is a fundamental limit of the architecture, not a bug — see
`CLAUDE.md` non-goals and D-005 (`docs/adr/npm-client/0006-shadow-registry.md`).

## What the installer does (ADR-0051)

At resolve time, `@riftydev/npm-client`'s installer flags a package as
native-incompatible when its manifest pins a **`cpu`** constraint to a non-empty
set that excludes the WebAssembly targets rifty can execute (`wasm`, `wasm32`)
— the reliable marker of a compiled native artifact. (`os`-only is *not* a
trigger: many pure-JS packages pin `os` for soft warnings, and `cpu`-less
natives are rare.)

- **Required** native dep (or a native top-level request) → the install
  **aborts** with `ENATIVEUNSUPPORTED` (`err.code`), carrying `packageName`,
  `version`, `reason`, and `platform: { os, cpu }`.
- **Optional** native dep (`optionalDependencies`) → **skipped with a warning**,
  matching npm's non-fatal-optional contract. This is why esbuild's `@esbuild/*`
  platform binaries (optional) are skipped and Vite still installs.
- A package with a **shadow-registry substitution** (user `overrides` or the
  baked table, D-005) is redirected to its pure-JS/WASM replacement *before* the
  check, so it never trips. Baked substitutions are **never silent**: the install
  output names the shadow registry for every redirect and internals patch
  (ADR-0188). An installed version outside a shim's proven range fails loudly
  with `NotImplementedError('shadow-registry.<pkg>@<version>')` — a stale shim
  is never applied silently.

## Known native-incompatible packages

| Package | Why | rifty status |
|---|---|---|
| `opencode-ai` | Distributed as a native binary (`bin: opencode.exe`, `os`/`cpu`, platform-binary optional deps). | ❌ `ENATIVEUNSUPPORTED` — cannot run; no JS port. |
| `better-sqlite3` | node-gyp native addon. | ❌ — use `sql.js` / `@sqlite.org/sqlite-wasm` via an `override` (D-005). |
| `bcrypt` | Native addon. | ✅ auto-shimmed → `bcryptjs` (baked override; the install prints the substitution line). |
| `fsevents` | macOS-only native; always an `optionalDependency`. | ⏭️ skipped with warning (non-fatal). |
| `@esbuild/<platform>` | esbuild's platform binaries (optional deps of `esbuild`). | ⏭️ skipped; the installer materializes the `esbuild` entry from the shadow-registry shim at install time (ADR-0188) — backed by the real `esbuild-wasm` host bridge (full JS API: `transform`/`build`/`context`, ADR-0192; gaps in [esbuild-js-api.md](./esbuild-js-api.md)). **Vite 8 transforms via oxc/Rolldown, not esbuild** — no esbuild shim lands in a Vite 8 tree. |
| `@rollup/rollup-<platform>` | rollup's optional native binaries. | ⏭️ skipped; the installer patches `rollup/dist/native.js` at install time to the real `@rollup/wasm-node` parser, co-installed in version lockstep (ADR-0188). Vite 8 parses via `rolldown/parseAst`, not rollup — no rollup shim in a Vite 8 tree. |
| `@rolldown/binding-<platform>` | Rolldown's native platform bindings. | ⏭️ skipped for native platforms; `@rolldown/binding-wasm32-wasi` installs and is wired through `node:wasi` + kernel-backed `worker_threads`; full createServer/transform proof requires a SAB + kernel-worker browser harness. |

## Escape hatch

If a package is flagged but you have a pure-JS/WASM replacement, add an npm
`overrides` entry in your `package.json` (or, for broadly-useful cases, a baked
entry in `@riftydev/shadow-registry`):

```json
{ "overrides": { "better-sqlite3": "sql.js" } }
```

A self-map (`"pkg": "pkg"`) bypasses the check if you're certain a `cpu`-pinned
package is actually pure-JS (rare). See `docs/adr/npm-client/0051-native-dependency-install-policy.md`.
