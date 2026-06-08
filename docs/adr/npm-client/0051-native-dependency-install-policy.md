# ADR 0051: Native-dependency install policy — loud `ENATIVEUNSUPPORTED`, optional natives skipped

Status: Accepted (promotes Q-2026-05-30-001)
Date: 2026-05-30

## Context

rifty runs JS + WASI WASM only — never `.node` node-gyp addons or native binaries (ELF/Mach-O/PE). Fundamental limit per `PROJECT_PLAN.md` non-goals, D-005, ADR-0006 ("what this won't fix"), ADR-0026 (`process.arch = 'wasm'`). The installer (`packages/npm-client/src/installer.ts`) previously installed such packages unconditionally → silently-broken tree. D-005 / ADR-0006 source #6 already committed to the fix: a documented incompatibility list surfaced as a clear install-time error.

Forcing consumer: **`opencode-ai`** ships as a native binary (`bin: {"opencode":"bin/opencode.exe"}`, `os`/`cpu` constraints, platform-binary `optionalDependencies`). Installing it can never yield a runnable tool, so running OpenCode in rifty is infeasible by design — fail loudly, point at docs.

Subtlety: esbuild/rollup platform binaries (`@esbuild/*`) are `optionalDependencies` carrying `os`/`cpu`. The working Vite-in-Worker install (ADR-0043) pulls them; the installer's optional-dep loop already catches-and-warns on their failure, and esbuild/rollup JS entry files are replaced by a post-install VFS overlay (ADR-0047/0015), not by blocking the optionals. The policy must not make those optional failures fatal.

Decided via a deliberation agent with adversarial false-positive + optional-handling analysis.

## Decision

- **D1 — `cpu`-keyed detection (conservative).** A manifest is native-incompatible iff `manifest.cpu` is a non-empty array admitting neither `wasm` nor a `!`-negation. `os`-alone is NOT a trigger (pure-JS pkgs pin `os` for soft warnings; `cpu`-less natives like `fsevents` are optional). `node-gyp`/`prebuild` scripts and `.node`-file presence are deferred secondary signals (rifty runs no install scripts; `.node` is post-unpack only).
- **D2 — Placement: registry resolve, after override, gated on `!override`.** Check fires in `createRegistrySource.resolve` after manifest selection, only when no shadow substitution applied (`resolveOverride` covers user + baked overrides — e.g. `bcrypt → bcryptjs` redirects to a trusted pure-JS target and pre-empts the check). Not run on the lockfile fast-path (already-admitted graph).
- **D3 — Optional natives skip, required natives abort.** `assertNativeSupported` throws unconditionally; `walkAndPin`'s required-dep loop propagates (aborts), its optional-dep loop already try/catches + warns (skips). No new control flow — inherits npm's non-fatal-optional contract, so `@esbuild/*` optionals skip and Vite still installs.
- **D4 — Loud-throw shape.** `Object.assign(new Error(msg), { code: 'ENATIVEUNSUPPORTED', packageName, version, reason: 'cpu-constraint', platform: { os, cpu } })`, matching `EVERSIONCONFLICT`/`EBROKENLOCK` style. Message names package@version, cpu/os indicators, states no substitution is registered, points at `docs/compat/incompatible-packages.md`.

## Consequences

- `registry.ts`: `VersionManifest` gains additive optional `os?: string[]` / `cpu?: string[]`.
- `installer.ts`: `assertNativeSupported()` + guarded call in `createRegistrySource`.
- New `docs/compat/incompatible-packages.md` (referenced by the error).
- Required natives / native top-level requests fail loudly; optional natives unaffected (skip+warn); shadow-substituted + pure-JS unaffected.
- Conformance `packages/npm-client/src/installer-native-policy.test.ts`: native top-level → throws; required transitive → aborts; optional transitive → skip+warn; `os`-only → not rejected; `cpu:['wasm']` → not rejected; baked `bcrypt→bcryptjs` override → installs.

## Reversibility

REVERSIBLE (recorded as ADR because it adds a public-ish error code): additive optional manifest fields, no new dependency, contradicts no ADR (implements ADR-0006 source #6), reverting is one function + its call site + one doc.

## Risks / follow-ups

- **`.node` post-unpack scan deferred** — a `cpu`-less native shipping a bare `.node` slips through (false-negative; acceptable per prefer-false-negatives bar). Add a post-unpack scan if such a package surfaces.
- **`cpu`-pinned pure-JS false-positive** (vanishingly rare) — the override escape hatch (self-map) clears it; the error advertises this.

## References

- D-005 / ADR-0006 (shadow registry — source #6 documented-incompatibility).
- ADR-0026 (`process.arch = 'wasm'`); ADR-0027/0015 (shim overlays); ADR-0042/0043 (nested install; Vite-in-Worker — pulls esbuild's optionals).
- `docs/large-targets-readiness-2026-05-27.md` §OpenCode "Native dep policy".
- Q-2026-05-30-001 (promoted here).
