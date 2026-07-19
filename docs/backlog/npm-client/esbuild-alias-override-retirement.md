---
area: npm-client
status: ready
title: Retire the @esbuild/wasi-preview1 alias override — synthesize the delegate, remove measured network bytes nobody reads
created: 2026-07-13
why: install pulls the full alias package whose bytes the delegate shim immediately shadows; with the Workbench runtime-asset path (ADR-0249) the executed bytes have their own honest path
user_story: As a developer installing a Vite project, I want cold install to stop downloading the measured alias response bytes that a tiny delegate overwrites and nobody reads, but today the override stays load-bearing because nothing measured whether dropping it breaks real-Vite e2e
epic: honest-shadow-substitutions
blocked_by: [distribution/workbench-runtime-asset-cutover]
sources: [docs/adr/npm-client/0298-synthesize-esbuild-delegates-with-explicit-lockfile-materialization-provenance.md, docs/adr/npm-client/0295-persist-exact-applied-shadow-substitution-facts-in-lockfiles.md, docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md, docs/adr/npm-client/0258-structured-install-acquisition-provenance.md, docs/adr/npm-client/0188-install-time-shadow-internals-shims-with-companion-pins-and-substitution-provenance.md, docs/adr/npm-client/0195-eddy-wire-protocol-v1-1-get-by-hash-cors-simple-post-streaming-client-prefetch-seam.md]
code: [tools/shadow-registry/src/index.ts, tools/shadow-registry/src/index-data.ts, tools/shadow-registry/src/shadow-asset-catalog.ts, tools/shadow-registry/tools/generate-install-artifact-identity.ts, packages/npm-client/src/installer.ts, packages/npm-client/src/linker.ts, packages/npm-client/src/shadow-shims.ts, packages/npm-client/src/overrides.ts, packages/npm-client/src/shadow-asset-lockfile-facts.ts, packages/npm-client/src/shadow-asset-lockfile-recipes.ts, packages/npm-client/src/shadow-assets.ts, packages/npm-client/src/eddy-request.ts, packages/workbench/src/workbench/internal/playground-owner-protocol.ts, services/eddy/src/resolver.ts, tests/integration/workbench-packed-consumer.mjs]
---

## Context

ADR-0249 gives the executed 13,918,738-byte esbuild WASM member an exact
asset descriptor, verified store, receipt, and child capability. The remaining
`bakedOverrides.esbuild` redirects the public request to
`@esbuild/wasi-preview1@0.28.0`; ADR-0188 then overwrites its entry points with
two tiny delegate files. No alias package byte executes.

The authoritative packed control used a fresh temp consumer and npm cache, 13
packed first-party plus 74 external packages, fresh Chromium context, ephemeral
Workbench with `memory-session` storage, loopback validating STD registry
`http://127.0.0.1:54321`, and cold open through preview plus native
same-document HMR readiness. Over the 10,029,632-byte Vite snapshot SHA-256
`7233a01db2259171e0607bbb9891ddc7efe78369f59077e44675300cccca7aa5`, it
observed:

- `GET /@esbuild%2Fwasi-preview1`: 627 response-body bytes;
- `GET /-/tarballs/%40esbuild%2Fwasi-preview1-0.28.0.tgz`: 5,057,200
  response-body bytes;
- alias total: 5,057,827 response-body bytes.

The fixture registry repacks the committed snapshot, so that tarball's SRI is
deliberately not the official npm SRI. Its empty-cache offline install,
typecheck, build, and real Chromium journey are GREEN, including
`cache-check -> fetch -> verify -> persist -> ready`. The after proof repeats
that origin because the packument embeds the tarball URL. These numbers are
neither official-registry bytes nor the runtime-asset fill metric.

ADR-0298 resolves the irreversible shape: normal public version selection,
one immutable synthesized delegate recipe, explicit per-entry lockfile
materialization evidence, an honest `synthesized` package transport, and the
same validator/materializer on live, replay, and Eddy paths.

## Acceptance

1. Preserve the authoritative RED produced by
   `RIFTY_PACKED_CONSUMER_REGISTRY_PORT=54321 pnpm test:packed-consumer` over the
   named snapshot: exact origin, boundary, storage class, every registry
   response URL/status/body byte count, repacked alias SRI, and 627 + 5,057,200
   = 5,057,827 alias response-body bytes. The native HMR oracle must retain its
   global sentinel and observe neither `beforeunload` nor a full reload.
2. `@riftydev/shadow-registry` root exports the one generated readonly
   `builtinSyntheticPackageRecipes` data surface, exact-validated against the
   asset catalog. A fresh direct or transitive request resolved by normal
   public esbuild metadata to exact `0.28.0` writes only
   `node_modules/esbuild/package.json` and `lib/main.cjs` from that recipe. It
   writes no
   `node_modules/@esbuild/wasi-preview1`, downloads neither alias nor public
   esbuild tarball, and creates no synthetic tarball-cache entry.
3. The lockfile package row has version `0.28.0`, no `resolved`/`integrity`, and
   the exact ADR-0298 `rifty.lockfile-package-materialization/v1` marker. Its
   recipe digest, active v2 applied trace, runtime adapter, entry path/version,
   and append-only recipe ledger agree. The emitted line is exactly
   `npm: esbuild@<range-or-*> → esbuild@0.28.0 (synthesized delegate from shadow registry, ADR-0298)`.
4. A second install replays the same files and line with zero esbuild
   packument/tarball/cache reads. Contract tests cover a top-level placement, a
   hoisted transitive placement, and a nested synthesized placement beside an
   ordinary same-name/same-version package selected by a root-scoped user
   override. Materialization-aware placement, visit/single-flight dedupe, and
   trace validation bind the exact row rather than collapsing by public
   name/version.
5. `InstallAcquisitionProvenance.packages` reports the delegate transport as
   `synthesized` on live, replay, and Eddy paths. The tarball-only `onPackage`
   hook emits no delegate event. No successful result calls the bytes
   `registry`, `cache`, or `eddy`.
6. A user same-name override such as `esbuild: esbuild@0.28.0`, a parent-scoped
   user override, and a user redirect all bypass builtin synthesis for the
   matching request. They follow the ordinary verifying package path, including
   its existing lifecycle/native loud gaps, and receive no builtin fact merely
   because the installed name/version matches.
   When another unoverridden parent requests the builtin in the same tree, its
   distinct nested recipe alone contributes the trace/plan; provenance retains
   both same-coordinate rows with `registry|cache|eddy` versus `synthesized`.
7. Eddy requests preserve exactly the user `overrides` field and never encode
   the builtin as one. Resolver output, closure hashing, bundle harvest,
   completeness, client adoption, and lockfile replay accept a missing tarball
   only for the exact marker. Current bundles install synthesized bytes; an
   unsupported/corrupt/drifted marker declines before staging and visibly falls
   back to STD, never `source:'eddy'` plus a hidden registry fetch.
8. The synthesis recipe/protocol/id/files are included in
   `installArtifactIdentity`; removing the alias override/shim changes it and
   all dependency snapshots are regenerated. A delegate/tree recipe mutation
   flips identity and recipe digest. Changing only asset package SRI/member/
   caps changes the required-set digest but not tree identity.
9. `tests/browser-unit/esbuild-vite-contract.spec.ts` is GREEN against the
   exact Node `esbuild@0.28.0` fixtures through Vite `7.3.6` dev, build,
   preview, and optimize. The packed consumer remains GREEN with native HMR
   evidence (update frame, retained global sentinel, no `beforeunload`).
10. Repeat the fixed-origin packed command after synthesis with the same fresh
    cache/context, STD transport, storage class, and end-to-end boundary. The
    audit must show zero alias requests/bytes, one public esbuild packument
    selection, no esbuild tarball, and a complete response list. Commit the
    exact before/after total response-body delta; claim latency only if the
    paired boundary/regimes match. The 5,057,827 alias bytes are not
    automatically the net delta.
11. Update npm-client, shadow-registry, Workbench, Eddy, esbuild/Vite compat,
    and affected snapshot changelogs/docs. Delete this item on GREEN; source
    grep or an opt-in-only lane cannot close it.

## Reference contract

- Oracle: Node 24.16.0 with native `esbuild@0.28.0`; real `vite@7.3.6`; committed
  `esbuild-0.28.0-contract.json` and guest-policy fixture generated from that
  oracle.
- Mechanism: ADR-0226's generated upstream `esbuild-wasm@0.28.0` browser client
  over owner VFS; synthesis moves the existing package delegate bytes and does
  not copy or approximate the esbuild API.

## Parity cases

1. CJS `require('esbuild')`, ESM import/default/namespace identity, version
   `0.28.0`, `PluginBuild.esbuild`, repeated namespace identity, and runtime
   publication-before-import match the frozen Node oracle in all four Vite
   modes.
2. Vite dev loads a TypeScript config graph and dependency; real optimize writes
   and consumes a CJS prebundle plus parseable source map; build writes and
   executes the config-defined browser output; preview starts and loads the
   same delegate identity.
3. Every enumerated async API/result/error-order row and guest-policy row in
   `ESBUILD_CONTRACT_ROW_IDS`/`ESBUILD_GUEST_POLICY_ROW_IDS` remains equal to
   the native fixture or its named loud-gap expectation. No test fixture is
   rewritten to bless synthesis drift.
4. Direct and transitive `esbuild@0.28.0` requests select the same public
   version npm would select before applying the local recipe. A public registry
   failure is observed before any synthesis; an unsupported selected version
   loud-throws rather than silently falling back to 0.28.0.
5. Live resolution, matching lockfile replay, Eddy replay, hoisted placement,
   and nested placement materialize byte-identical package files and exact
   trace/marker/provenance. A same-name user override enters the ordinary path
   and produces no builtin trace; a script-free oracle manifest proves its
   ordinary bytes remain distinct from the synthetic recipe.
6. Default Vite `8.0.16` retains the canonical empty plan and makes no esbuild
   packument, synthesis, asset, capability, or progress request.

## Fault matrix

| Axis × operation | Injected fault | Honest outcome / fault-test target |
|---|---|---|
| `unbounded-read` × public selection | esbuild packument headers/body stall or exceed the existing bound | Existing bounded registry error; no hard-coded selection, tree write, or marker. |
| `torn-state` × materialization | one synthetic file/link write fails before lockfile commit | Install fails nonzero; no new lockfile/claim/readiness success. Existing tree mutation authority remains the sole fence. |
| `corrupt-input` × lockfile replay | extra/missing marker key, invalid digest, wrong row version/path, duplicate or trace mismatch | Exact validator rejects before write; known malformed active evidence is `EBROKENLOCK`, unsupported protocol/kind is the named loud gap. |
| `provenance-lie` × all acquisition paths | synth row is labelled cache/registry/eddy, or carries upstream `resolved`/`integrity` | Contract fails; only `synthesized` plus exact marker is accepted. |
| `false-fallback` × Eddy adoption | old/unknown/corrupt synthetic marker or missing synthetic proof | Decline before staging, visible STD fallback; no partial Eddy success and no hidden tarball omission. |
| `poisoned-cache` × tarball cache | a cache entry exists for esbuild/alias coordinates | Synthesis does not read it; ordinary user-override installs still verify it through the standard chokepoint. |
| `observable-order` × override/version gate | user same-name override, registry failure, no satisfying version, unsupported selected version | User override wins; real registry/selection errors precede the rifty version gap; no builtin trace is minted before materialization. |
| `sibling-drift` × live/replay/Eddy | one path changes recipe bytes, digest validation, dependencies, or provenance | One recipe/validator/materializer is shared; differential suite fails all paths together. |
| `lossy-aggregate` × placement/provenance/identity | registry and synthesized rows share name/version; file bytes, marker, recipe id, or asset pin changes independently | Materialization key prevents placement/single-flight/provenance collapse; full tree recipe changes install identity/digest; marker changes closure; asset-only pins change only required-set identity. |
| `concurrent-same-key` × install | two visits resolve the same recipe while registry fetches and a same-coordinate user package are in flight | Same recipe single-flights/materializes once; different materialization keys never join, overwrite, or borrow transport. Existing serialized install remains the writer. |

## Out of scope

- Any selected esbuild version other than exact `0.28.0` throws
  `NotImplementedError('shadow-registry.esbuild@<selected-version>')`; there is
  no best-effort nearest version.
- Unknown lockfile materialization protocols, kinds, and external recipe ids
  throw `NotImplementedError('npm-client.lockfile.packageMaterialization')`;
  there is no public recipe/plugin/catalog construction API.
- The synthetic recipe has an empty bin map. `which esbuild` is absent and
  direct `esbuild` shell invocation exits nonzero as command-not-found; this is
  compat ❌, not a synthesized CLI.
- Import/require outside owner-prepared Vite 7 throws exactly
  `rifty invariant: esbuild runtime slot is not initialized`; synthesis does
  not promise a general Node-process esbuild service.
- Existing Vite-facing gaps remain explicit compat ⚠️/❌:
  `NotImplementedError('esbuild.initialize')`, `('esbuild.stop')`,
  `('esbuild.transformSync')`, `('esbuild.buildSync')`,
  `('esbuild.formatMessagesSync')`, `('esbuild.analyzeMetafileSync')`,
  `('esbuild.analyzeMetafile')`, `('esbuild.context.watch')`,
  `('esbuild.context.serve')`, and `('esbuild.build.write')` under their
  existing native-validation/error-order gates.
- An explicit user redirect to `@esbuild/wasi-preview1` is ordinary user
  policy: no builtin delegate, trace, asset, or capability is inferred. Other
  baked overrides (`bcrypt`, `lightningcss`) are unchanged.
- A same-name user override does not bypass ordinary lifecycle policy: the
  official esbuild manifest's `postinstall` remains the existing loud
  `NotImplementedError('npm-client.lifecycle.postinstall')` path. This item
  neither runs nor silently ignores registry lifecycle scripts.
- Official npm-registry byte/latency claims, non-Chromium support, direct
  esbuild CLI support, a second synthetic package, and external synthesis
  registries are not delivered by this item.

## Decisions

- ADR-0298 owns public version selection, immutable recipe shape, exact
  per-entry marker/replay, `synthesized` acquisition provenance, Eddy behavior,
  historical trace handling, tree identity coupling, and measurement boundary.
  Shadow-registry exposes only generated clone-safe recipe data. One package-
  private npm-client deep materialization module owns the closed registry/
  synthesis union and every projection; `install()` remains its external test
  surface and no hypothetical public adapter interface is added.
- ADR-0295 owns the top-level applied trace and append-only historical recipe
  ledger. The active synthesis mints a new v2 recipe id; the alias v1 record is
  retained only as a tombstone, never an active fallback.
- ADR-0249 keeps tree recipe identity independent from asset descriptor
  identity and makes exact runtime bytes ready through the Workbench manager.
- User overrides always outrank builtin synthesis and never mint builtin facts.
  STD is the sole Eddy fallback; no new transport, cache, owner, or migration
  mechanism is introduced.
