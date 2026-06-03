# Incompatible packages

rifty runs **JavaScript + WASI WebAssembly only**. It can never load native
`.node` addons (node-gyp) or execute native compiled binaries (ELF / Mach-O /
PE). This is a fundamental limit of the architecture, not a bug — see
`PROJECT_PLAN.md` non-goals and D-005 (`docs/adr/0006-shadow-registry.md`).

## What the installer does (ADR-0051)

At resolve time, `@riftydev/npm-client`'s installer flags a package as
native-incompatible when its manifest pins a **`cpu`** constraint to a non-empty
set that excludes `wasm` (the rifty arch, ADR-0026) — the reliable marker of a
compiled artifact. (`os`-only is *not* a trigger: many pure-JS packages pin
`os` for soft warnings, and `cpu`-less natives are rare.)

- **Required** native dep (or a native top-level request) → the install
  **aborts** with `ENATIVEUNSUPPORTED` (`err.code`), carrying `packageName`,
  `version`, `reason`, and `platform: { os, cpu }`.
- **Optional** native dep (`optionalDependencies`) → **skipped with a warning**,
  matching npm's non-fatal-optional contract. This is why esbuild's `@esbuild/*`
  platform binaries (optional) are skipped and Vite still installs.
- A package with a **shadow-registry substitution** (user `overrides` or the
  baked table, D-005) is redirected to its pure-JS/WASM replacement *before* the
  check, so it never trips.

## Known native-incompatible packages

| Package | Why | rifty status |
|---|---|---|
| `opencode-ai` | Distributed as a native binary (`bin: opencode.exe`, `os`/`cpu`, platform-binary optional deps). | ❌ `ENATIVEUNSUPPORTED` — cannot run; no JS port. |
| `better-sqlite3` | node-gyp native addon. | ❌ — use `sql.js` / `@sqlite.org/sqlite-wasm` via an `override` (D-005). |
| `bcrypt` | Native addon. | ✅ auto-shimmed → `bcryptjs` (baked override). |
| `fsevents` | macOS-only native; always an `optionalDependency`. | ⏭️ skipped with warning (non-fatal). |
| `@esbuild/<platform>` | esbuild's platform binaries (optional deps of `esbuild`). | ⏭️ skipped; the `esbuild` JS entry is overlaid by the WASI shim (ADR-0047). |
| `@rollup/rollup-<platform>` | rollup's optional native binaries. | ⏭️ skipped; rollup JS entry overlaid. |

## Escape hatch

If a package is flagged but you have a pure-JS/WASM replacement, add an npm
`overrides` entry in your `package.json` (or, for broadly-useful cases, a baked
entry in `@riftydev/shadow-registry`):

```json
{ "overrides": { "better-sqlite3": "sql.js" } }
```

A self-map (`"pkg": "pkg"`) bypasses the check if you're certain a `cpu`-pinned
package is actually pure-JS (rare). See `docs/adr/0051-native-dependency-install-policy.md`.
