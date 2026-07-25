# ADR 0320: Define instant restore runtime asset availability

Status: Accepted
Date: 2026-07

> TL;DR: instant still restores `node_modules` without `npm install`; Vite 7
> fills an empty verified esbuild runtime-asset CAS from the registry and fails
> loudly offline, while a warm CAS and Vite 8 need no esbuild registry request.

## Context

ADR-0135 called the baked instant snapshot both a no-install and a no-network
path. ADR-0316 removed its vendored esbuild carrier; ADR-0311 made the
registry-owned, SHA-verified shadow store the only esbuild runtime-byte source.
The snapshot still carries the installed tree and lockfile, not that store.
The no-network clause now contradicts the browser-observed cold path.

## Decision

1. This ADR refines and supersedes only ADR-0135's zero-registry/no-network
   claim. `instant` remains baked tree restore with no `npm install`,
   package-tree resolver, or silent install fallback.
2. Vite 7.3.6 with esbuild 0.28.0 and an empty verified shadow CAS requests
   exactly `/npm-registry/esbuild-wasm` and
   `/npm-registry/esbuild-wasm/-/esbuild-wasm-0.28.0.tgz` before child
   admission. No snapshot, host-asset, or approximate fallback supplies the
   runtime bytes.
3. Cold offline absence fails admission loudly with `ShadowAssetError:
   failed to acquire esbuild-wasm@0.28.0/package/esbuild.wasm`. The
   `code: 'ESHADOWASSET'` / `phase: 'acquire'` fields exist only below the
   owner boundary (unit-pinned; the page serializer keeps name and message).
   A verified warm persistent CAS serves later owner boots with zero registry
   requests.
4. Sibling sweep: instant presets `project-files`, `node-worker`, and
   `typescript-ls` inherit the Vite 7 rule. `vite8` has an empty esbuild plan
   and makes neither request.

## Contract evidence

- [browser companion pins the exact cold Vite 7 requests](../../../tests/browser-unit/workbench-playground-companion.spec.ts);
- [Vite 8 empty adapter plan pinned in the esbuild/Vite contract](../../../tests/browser-unit/esbuild-vite-contract.spec.ts);
- [registry source faults pin loud offline acquisition failure and explicit retry](../../../packages/npm-client/src/internal/shadow/source.fault.test.ts);
- [public esbuild compatibility matrix](../../public/compat/esbuild-js-api.md).

## Fault matrix

| fault × operation | exact outcome / proof |
|---|---|
| `provenance-lie` × instant Vite 7 with empty CAS and offline registry | project admission rejects as `ShadowAssetError` ('failed to acquire …'; `ESHADOWASSET`/`acquire` fields unit-pinned below the owner boundary); no ready state or fallback |
| corrupt/torn retained asset × warm activation | manager rejects or reacquires through the verified CAS protocol; snapshot bytes never substitute |

## Consequences

- Instant keeps its user-visible distinction from from-scratch: local tree
  restore versus a real, visible `npm install`.
- A Vite 7 boot needs the registry when no verified runtime asset is available;
  offline failure is loud rather than a false ready state.
- ADR-0135's setup kinds, owner-seed restore, stamps, and baked-tree fidelity
  remain unchanged.
