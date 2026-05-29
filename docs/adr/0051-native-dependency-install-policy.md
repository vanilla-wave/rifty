# ADR 0051: Native-dependency install policy — loud `ENATIVEUNSUPPORTED`, optional natives skipped

Status: Accepted (promotes Q-2026-05-30-001)
Date: 2026-05-30

## Context

rifty runs JS + WASI WASM only; it can never load `.node` node-gyp addons or
execute native compiled binaries (ELF/Mach-O/PE) — a fundamental limit
(`PROJECT_PLAN.md` non-goals; D-005; ADR-0006 "what this won't fix"; ADR-0026
fixes `process.arch = 'wasm'`). The installer
(`packages/npm-client/src/installer.ts`) previously installed such packages
unconditionally, yielding a silently-broken tree. D-005 / ADR-0006 source #6
already committed to the remedy: a documented incompatibility list surfaced as a
clear error on attempted install.

Forcing consumer: **`opencode-ai`** (an AI coding CLI) ships as a native binary
(`bin: {"opencode":"bin/opencode.exe"}`, `os`/`cpu` constraints, platform-binary
`optionalDependencies`). Installing it can never yield a runnable tool — so
running OpenCode literally in rifty is infeasible *by design*; the right
behaviour is to fail loudly and point at the docs.

Subtlety: esbuild's platform binaries (`@esbuild/*`) and rollup's are
`optionalDependencies` carrying `os`/`cpu`. The working Vite-in-Worker install
(ADR-0043) pulls them; the installer's optional-dep loop already
catches-and-warns on their failure, and the esbuild/rollup JS *entry* files are
replaced by a post-install VFS overlay (ADR-0047/0015), not by blocking the
optionals. The policy must not turn those optional failures fatal.

Decided via a deliberation agent with an adversarial false-positive +
optional-handling analysis.

## Decision

- **D1 — `cpu`-keyed detection (conservative).** At resolve time, a manifest is
  native-incompatible iff `manifest.cpu` is a non-empty array that admits neither
  `wasm` nor a `!`-negation. `os`-alone is NOT a trigger (pure-JS packages pin
  `os` for soft warnings; `cpu`-less natives like `fsevents` are also optional).
  `node-gyp`/`prebuild` install scripts and `.node`-file presence are deferred
  secondary signals (rifty runs no install scripts; `.node` is post-unpack only).
- **D2 — Placement: registry resolve, after override, gated on `!override`.** The
  check fires in `createRegistrySource.resolve` after the manifest is picked, and
  only when no shadow substitution applied (`resolveOverride` covers user + baked
  overrides). A substitution already redirected to a trusted pure-JS target
  (`bcrypt → bcryptjs`), so it pre-empts the check. Not run on the lockfile
  fast-path (an already-admitted graph).
- **D3 — Optional natives skip, required natives abort.** `assertNativeSupported`
  throws unconditionally; `walkAndPin`'s required-dep loop propagates (aborts),
  its optional-dep loop already try/catches + warns (skips). No new control flow
  — the policy inherits npm's non-fatal-optional contract for free, so esbuild's
  `@esbuild/*` optionals skip and Vite still installs.
- **D4 — Loud-throw shape.** `Object.assign(new Error(msg), { code:
  'ENATIVEUNSUPPORTED', packageName, version, reason: 'cpu-constraint',
  platform: { os, cpu } })`, matching `EVERSIONCONFLICT`/`EBROKENLOCK` style. The
  message names the package@version, the cpu/os indicators, states no
  substitution is registered, and points at
  `docs/compat/incompatible-packages.md`.

## Consequences

- `registry.ts`: `VersionManifest` gains additive optional `os?: string[]` /
  `cpu?: string[]`.
- `installer.ts`: `assertNativeSupported()` + a guarded call in
  `createRegistrySource`.
- New `docs/compat/incompatible-packages.md` (the list the error references).
- Required natives / native top-level requests fail loudly; optional natives
  unaffected (skip+warn); shadow-substituted + pure-JS unaffected.
- Conformance: `packages/npm-client/src/installer-native-policy.test.ts` (native
  top-level → throws; required transitive → aborts; optional transitive →
  skip+warn; `os`-only → not rejected; `cpu:['wasm']` → not rejected; baked
  `bcrypt→bcryptjs` override → installs).

## Reversibility

REVERSIBLE (recorded as an ADR because it adds a public-ish error code): additive
optional manifest fields, no new dependency, contradicts no ADR (implements
ADR-0006 source #6), reverting is one function + its call site + one doc.

## Risks / follow-ups

- **`.node` post-unpack scan deferred** — a `cpu`-less native shipping a bare
  `.node` would slip through (false-negative; acceptable per the
  prefer-false-negatives bar). Add a post-unpack scan if such a package surfaces.
- **`cpu`-pinned pure-JS false-positive** (vanishingly rare) — the override
  escape hatch (self-map) clears it; the error advertises it.

## References

- D-005 / ADR-0006 (shadow registry — source #6 documented-incompatibility).
- ADR-0026 (`process.arch = 'wasm'`); ADR-0027/0015 (shim overlays); ADR-0042/0043
  (nested install; Vite-in-Worker — the path that pulls esbuild's optionals).
- `docs/large-targets-readiness-2026-05-27.md` §OpenCode "Native dep policy".
- Q-2026-05-30-001 (promoted here).
