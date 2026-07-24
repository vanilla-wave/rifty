# ADR 0316: Retire the vendored esbuild WASI consumer after registry cutover

Status: Accepted
Date: 2026-07

> TL;DR: registry-attested `esbuild-wasm@0.28.0` is the sole Workbench esbuild
> runtime; remove the checked-in WASIp1 carrier and keep preview1 only as an
> explicitly selected, package-sourced WASI guest.

## Context

ADR-0047 corrected a false premise: swc had no WASIp1 build, while
`@esbuild/wasi-preview1@0.28.0` was a genuine preview1 module, distinct from
gojs `esbuild-wasm`. Its real CLI forced the cwd, `AT_FDCWD`, directory-open,
and stdin behavior recorded in ADR-0049. It then became a checked-in
`esbuild.wasm`, fetch script, shadow-registry binding, product transform path,
and test-tool provider.

ADR-0308 now gives browser projects one stronger authority. The installed
substitution recipe acquires exact `esbuild-wasm@0.28.0` bytes, verifies them,
and admits one runtime capability used by direct CJS/ESM and Vite. Retaining
the ADR-0047 carrier beside that path leaves a second esbuild authority and
violates the esbuild/Vite cutover contract.

The separate WASI showcase still needs a real preview1 CLI guest. It is explicit
user intent, not Workbench esbuild activation, so it owns separate package
provenance and acceptance instead of retaining the product carrier.

## Decision

- `esbuild-wasm@0.28.0`, acquired and attested by the builtin registry recipe,
  is the only product/browser esbuild runtime. Direct esbuild and Vite consume
  it through ADR-0308 admission; Workbench never implicitly fetches or installs
  `@esbuild/wasi-preview1`.
- Delete the old alias/overlay, `esbuild-binding`, `esbuild-transform`,
  package/tsup exports, fetch script, checked-in blob, and every product
  consumer. The `esbuild` CLI remains
  `NotImplementedError('esbuild.cli')` + compat ❌.
- Runtime-wasi conformance and the explicit WASI showcase use exact
  `@esbuild/wasi-preview1@0.28.0` package bytes. A shared strict fixture pins:
  npm integrity
  `sha512-6Mm1hljxx5NJgqnZupvOLfGGKW+9icZUottY+D1a7+QmddYogj84mAFfgZiobQG4qMbW9tIQubV0lL9XGFKLiw==`,
  `esbuild.wasm` size `20174983`, and SHA-256
  `c98e9dd502b5c59645e7cf1b6ee85d167fbce34fcf270cbafbadec257b318d2b`.
  Drift rejects before execution.
- The Playground preset declares that exact dependency in its visible project
  manifest and acquires it only through the normal validating project install.
  The Node standalone example declares the same exact dependency and resolves
  its installed package member. Browser and Node acceptance share the fixture
  and output oracle.
- The explicit guest path cannot supply Workbench esbuild activation, hide
  inside a baked dependency snapshot, reuse the deleted vendor path, restore an
  alias/overlay, or weaken Vite's zero-preview1-request proof. Its separate
  browser request is asserted only after the user selects the WASI preset.
- ADR-0049 remains active unchanged. Its public cwd/preopen and syscall
  behavior outlives the consumer that forced it.
- `ModuleLoaderOptions.transformSource` stays provider-neutral and async.
  Node-only parity tooling may inject exact host `esbuild@0.28.0`; product
  behavior is closed only by the registry-owned Chromium differential.
- The private `vite-like-dev` example has no implicit transform provider:
  plain JS works; TS/TSX/JSX without an injected real transform throws
  `NotImplementedError('vite-like-dev.transformModule')`.

## Retained ADR-0047 facts

- swc's published WASM was wasm-bindgen, not WASIp1.
- `@esbuild/wasi-preview1@0.28.0` imports only
  `wasi_snapshot_preview1`; gojs `esbuild-wasm` is a different package/runtime.
- The CLI's real cwd/preopen behavior forced ADR-0049.
- A generic gojs bridge remains unnecessary for esbuild and is not introduced.

## Alternatives

- **Delete all real-tool WASI proof.** Rejected: tiny fixtures do not prove the
  runner still hosts a real transformer.
- **Keep the checked-in binary only for tests/showcase.** Rejected: the retired
  carrier can silently regain a product consumer and costs a permanent blob.
- **Use the WASIp1 CLI as the product adapter.** Rejected: it restores two
  runtime authorities and cannot preserve the upstream JS API/context contract
  proven by ADR-0226.

## Consequences

- Product esbuild has one asset provenance, lifecycle, and admission path.
- Repository and deployment sources lose the ~20 MB checked-in WASI blob.
- Conformance installs one exact test-only package. A future explicit showcase
  request is independently visible, digest-checked, and user-selected.
- This ADR supersedes ADR-0047 and corrects old carrier/provider clauses in
  ADR-0011, ADR-0051–0053, ADR-0070, ADR-0135, ADR-0172–0173, ADR-0188,
  ADR-0193, and ADR-0226. ADR-0049 is unchanged.
