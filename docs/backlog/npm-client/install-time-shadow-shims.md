---
area: npm-client
status: ready
title: Install-time shadow shims + loud substitution lines
created: 2026-07-02
why: vite works only because the vite-preset boot overlays internals shims into three hardcoded /workspace/node_modules paths — hand-installed vite in a fresh project gets nothing, and all shadow-registry substitutions happen silently
user_story: As a developer, I want `npm i vite && npm run dev` in an empty project to work exactly like the preset — and to SEE in the npm output when a dependency was substituted — but today shims apply only at vite-preset boot and substitutions print nothing.
epic: preset-deglue
blocked_by: []
sources: [docs/adr/npm-client/0006-shadow-registry.md, docs/adr/npm-client/0015-shadow-registry-consolidation.md, docs/adr/npm-client/0051-native-dependency-install-policy.md]
code: [tools/shadow-registry/src/index.ts, packages/npm-client/src/overrides.ts, packages/npm-client/src/installer.ts, apps/playground/src/glue/esbuild-shim.ts]
---

## Context

Shadow-registry carries two mechanisms. (1) `bakedOverrides` name-keyed package swaps (`bcrypt→bcryptjs`, `esbuild→@esbuild/wasi-preview1`, `lightningcss→lightningcss-wasm`) — applied by npm-client on every install, silently: the user installs `esbuild` and gets a different package with no trace in the output. (2) Internals shim file-sets (`browserShimFileSets`: `rollup/dist/native.js`, `esbuild/lib/main.js`, lightningcss) — written by playground `overlayShims()` at vite-preset boot only, at hardcoded top-level `/workspace/node_modules/...` paths. Net effect: preset vite works, hand-installed vite in a scratch project doesn't; nested layouts miss the shims; substitution provenance is invisible.

## Acceptance

- The installer applies internals shims at install time, keyed `package@version-range`, into the actual installed package directory (layout-independent — nested/hoisted installs included). Playground `overlayShims()` + `glue/esbuild-shim.ts` deleted; the vite preset boots green through the install-time path alone.
- EVERY shadow-registry substitution prints an explicit npm-output line naming the shadow registry: bakedOverrides redirect → `npm: esbuild@<range> → @esbuild/wasi-preview1@<v> (substituted from shadow registry, ADR-0051)`; internals shim → `npm: rollup@<v> internals patched from shadow registry`. Printed on fresh install AND on lockfile replay.
- Installed version outside a shim's supported range → loud `NotImplementedError('shadow-registry.<pkg>@<version>')` + compat-matrix ❌ — never a stale shim silently applied.
- e2e: empty project → `npm i vite` → `npm run dev` → preview serves, with zero preset machinery involved.

## Parity cases

- From-scratch `npm i vite && npm run dev` ≡ vite preset: same served preview, same node_modules shim state.
- Lockfile replay reproduces byte-identical shim files vs fresh install (shim application is a deterministic function of name@version).
- `npm install` output shows the substitution lines in both fresh and replay modes.

## Out of scope

- New shim targets beyond rollup/esbuild/lightningcss — other native packages keep ENATIVEUNSUPPORTED / NotImplementedError per ADR-0051.
- Generic postinstall-script execution — uniform rejection stands.
- An opt-out knob for baked substitutions (would reintroduce silent native breakage).

## Decisions

- Shim DATA stays in `@riftydev/shadow-registry` (ADR-0015); APPLICATION moves from playground boot to the npm-client install path — playground carries zero shim glue afterward. REVERSIBLE.
- No lockfile format change: replay re-derives shims from (name, version); no shim provenance persisted.
- Substitution message wording includes "shadow registry" verbatim — user-visible provenance is the point, not a debug log.
