# ADR 0336: Exact Vite 8 projects pin the proven Rolldown WASI runtime

Status: Accepted
Date: 2026-07-28

> TL;DR: A final exact Vite 8.0.16 manifest visibly overrides
> `@napi-rs/wasm-runtime` to `npm:@napi-rs/wasm-runtime@1.1.6` before identity,
> install, or snapshot bake; a caller-owned override wins.

## Context

ADR-0317 proved exact Vite 8.0.16 against the then-current public npm graph.
That exact root did not freeze its transitive closure. On 2026-07-28, npm
11.17.0 selected Rolldown 1.0.3, its exact WASI binding 1.0.3, and
`@napi-rs/wasm-runtime` 1.2.0. With `NAPI_RS_FORCE_WASI=1`, importing Rolldown
failed at WASM link time. Rifty selected the same graph, so changing its peer
or package selection would break npm parity rather than repair the project.

A standard npm alias override to runtime 1.1.6 makes both real npm and Rifty
select the proven binding/core/runtime tuple; the same forced-WASI import then
succeeds. A hidden resolver substitution would make package provenance false.
The existing Rifty snapshot lock is not npm-stable, while npm lockfile v3
optional edges are outside Rifty's current lock reader, so neither lockfile is
an honest shared carrier for this repair.

## Decision

1. Workbench manifest normalization is the one runtime owner. When the final
   Vite declaration is exactly `8.0.16`, it adds the visible npm-standard
   override `@napi-rs/wasm-runtime:
   npm:@napi-rs/wasm-runtime@1.1.6`.
2. A caller-provided value for that override key wins. Other caller overrides
   are preserved. Other Vite versions are unchanged.
3. The override is serialized before project identity. Public Workbench
   projects, Playground project definitions, browser install plans, and the
   snapshot bake consume those same final manifest bytes.
4. The Vite 8 snapshot is regenerated from that manifest. No npm resolver,
   shadow registry rule, Rolldown runtime branch, or peer-selection exception
   is added.
5. Upgrading exact Vite 8 or this runtime requires a fresh real-npm,
   real-Rifty, and Chromium proof.

## Proof contract

- Every exact/default 8.0.16 ingress carries the alias before identity;
  caller ownership and non-Vite-8 absence are unit-observable.
- The committed Vite 8 snapshot embeds the same package.json bytes and its
  generated identity matches the serialized artifact.
- Real npm 11.17.0 with WASI/wasm32 selection and Rifty install resolve runtime
  1.1.6 plus binding/core/runtime 1.0.3/1.10.0/1.10.0.
- Cold from-scratch build/preview and instant A→B→A restore pass in Chromium.

## Fault matrix

| Fault class | Required proof |
|---|---|
| frozen-assumption / provenance-lie | public-registry RED without the visible override; real npm and Rifty GREEN with it |
| sibling-drift | Workbench, Playground, bake input, snapshot package.json, and identity agree byte-for-byte |
| poisoned-cache | changed manifest identity rejects reuse of the pre-policy Vite 8 tree |

## Consequences

- (+) Users can inspect and reproduce the compatibility input with ordinary
  npm; registry behavior is not disguised as a Rifty resolver feature.
- (+) ADR-0317's generic installed-CLI path and ADR-0135's real install versus
  real snapshot distinction stay intact.
- (=) The claim remains exact Vite 8.0.16 build/preview with HMR off; broader
  Vite 8 and lockfile compatibility do not widen.
- (-) A future upstream closure change requires explicit revalidation and,
  when needed, another recorded manifest-policy change.
