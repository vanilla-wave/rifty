---
area: distribution
status: ready
title: no-COI packed toolchain surface — generic SDK and Worker JS/declaration graph
created: 2026-09-01
epic: no-coi-sandbox-tier
why: the workspace no-COI SDK path is green, but its real packed Workbench Worker graph imports an unpublished runtime-js subpath and the existing packed consumer hides declaration-graph errors with skipLibCheck; consumers need the generic exact-manifest-install/arbitrary-bin control surface to resolve from actual tarballs before the representative browser build loop can exercise it
user_story: As an agent-platform package consumer, I want an offline-installed SDK root plus no-COI Workbench Worker whose JavaScript and exact public control types resolve only published package seams, so my browser host can import the generic manifest-install/arbitrary-installed-bin surface without repository sources
sources: [ADR-0070, ADR-0374]
code: [packages/rifty/src/index.ts, packages/rifty/src/sandbox.ts, packages/runtime-js/package.json, packages/workbench/src/workers/no-coi-toolchain-worker.ts, tools/publishing/sync-publish-config.mjs, tests/integration/workbench-packed-consumer.mjs]
---

## Context

Split successor of `distribution/no-coi-sandbox-build-loop`. The existing packed
RED installs real workspace tarballs offline, then fails the emitted Workbench
Worker graph because `@riftydev/runtime-js/internal` exists in the workspace
manifest but ADR-0070 publish sync drops it. The SDK declaration graph also
imports `RuntimeToolchain` through that same undeclared seam, while the only
packed TypeScript consumer uses `skipLibCheck:true`.

User scope, 2026-09-01: this surface is generic. No SDK/runtime/control-plane,
package or distribution infrastructure may depend on Vite identity, version,
callbacks, paths, types or lifecycle. Its authority is: install one exact
manifest, then run an arbitrary admitted installed `node_modules/.bin` entry.
Vite is absent from this unit's semantic obligations.

## Predecessor clauses (verbatim)

Predecessor: `distribution/no-coi-sandbox-build-loop`. Checkpoint lineage and
attempt counts carry into this split successor.

> `createSandbox` admits no-COI only through the explicit existing
> `requireCrossOriginIsolation:false`; default admission still throws
> `COI_REQUIRED_MESSAGE`. `toolchain:{workerUrl}` handshakes the SDK toolchain Worker
> before returning and exposes the ADR-0374 install/run-bin methods over the
> same `runtime`/`fs` Worker. A valid backend paired with any mismatched
> protocol rejects `NotImplementedError('sandbox.toolchain.worker')` and
> terminates that Worker; it is never ignored or later admitted. Real packed
> SDK and Workbench tarballs expose a buildable SDK root and
> `no-coi-toolchain-worker` graph; neither depends on an unpublished runtime
> subpath.

> Default COI admission remains loud; generic createSandbox no-COI eval/fs
> keeps working when explicitly allowed; valid-backend protocol mismatch
> terminates through both public SDK and host-controller carriers. Real
> tarballs also build the SDK root and emitted Worker graph. Artifact:
> `pnpm exec vitest run --project unit packages/rifty/src/sandbox.test.ts
> packages/runtime-js/src/host.test.ts -t "valid backend but mismatched
> protocol|public admission rejects" --reporter=dot` and the no-COI
> preservation carrier; `pnpm test:packed-consumer` is the packed RED.

> `false-fallback` + `provenance-lie` × no-COI/toolchain admission and report |
> explicit opt-in + exact report; default remains COI throw; valid-backend
> protocol mismatch named + Worker terminated; packed SDK/Worker resolve only
> published runtime seams | Acceptance 3-4; Evidence R5-HANDSHAKE/R5-PACKED;
> no-COI preservation + capability RED

## Challenge

challenge: 2026-09-01 — 2 problems

- premise blocker — `user_story` promises actual exact-manifest install and
  arbitrary-bin execution, but Acceptance 1–6 proves only offline tarball
  resolution, bundling and types; Out of scope explicitly excludes npm/network,
  runtime and Chromium behavior, so claimed execution value does not follow.
- advisory — causal contribution not sized: one missing export and hidden
  declaration errors are evidenced, but no real package/bin runs here and no
  share of the remaining no-COI build-loop gap is shown; material user UX
  gain/opportunity cost remains unsubstantiated.

Disposition: premise blocker answered by narrowing this child's user story to
the packed import/control surface it proves. Actual install/run behavior stays
in the blocked build-loop and the frozen goal; the split changes ordering, not
the end-to-end value. Advisory retained.

## User scenario

A package consumer packs the real workspace SDK, Workbench and first-party
dependency closure, installs only those tarballs into an empty project with
network disabled, imports `createSandbox` from the packed SDK root and imports
the packed Workbench no-COI Worker entry. Its browser-target JavaScript graph
builds, and TypeScript checks the same public surface with strict declarations.
The consumer imports the generic exact-manifest install and arbitrary
installed-bin run control surface; invalid public shapes fail compilation.

## Reference contract

- Package authority: ADR-0070 derives built `dist` exports from the workspace
  manifest; the packed manifest and tarball contents, not workspace source
  resolution, are the consumer truth.
- Toolchain authority: ADR-0374 decisions 1-4 — explicit Worker URL, one
  Workbench Worker, exact-manifest install and arbitrary installed-bin
  run-to-completion control. The declared runtime `./internal` seam is repo-only
  and may publish only if its shared consumer suite proves the declaration/JS
  graph and `pnpm check:arch` retains the layer boundary.
- Type authority: TypeScript 5.9.3, `strict:true`, `skipLibCheck:false`, package
  exports resolution. Expected-error assertions prove rejected shapes rather
  than suppressing package declaration errors.

## Acceptance

1. The test builds the real workspace package closure, creates tarballs with
   the synced publish manifests, and installs them into a fresh consumer with
   network disabled. No workspace/link dependency or source directory remains.
2. One generic browser entry imports the packed `@riftydev/sdk` root; a second
   generic Worker entry imports
   `@riftydev/workbench/no-coi-toolchain-worker`. Both JavaScript graphs bundle
   from installed tarballs only. Every first-party import resolves through a
   declared packed export; the runtime public root remains closed and no
   consumer reaches package source.
3. The same packed consumer passes TypeScript 5.9.3 with `strict:true` and
   `skipLibCheck:false`. The complete first-party declaration graph resolves;
   no missing package subpath or declaration error is skipped.
4. Positive public types accept only the generic authority:
   `createSandbox({requireCrossOriginIsolation:false,
   toolchain:{workerUrl}})`, `install({cwd,registryUrl})`, and
   `runBin({cwd,binPath,args}) -> {exitCode:number}` for an arbitrary admitted
   installed bin.
5. Negative exact public-type carriers fail for invalid `SandboxToolchain`,
   `install` and `runBin` shapes: missing/wrong/extra fields, wrong argument
   types and wrong result type. `@ts-expect-error` is allowed only on the exact
   invalid expression; an unused directive fails the lane.
6. Publish-sync check, focused package builds/typechecks and package-surface
   tests stay green. The minimal runtime seam is exactly the declared
   `./internal` entry if architecture/ADR evidence still requires it; no wider
   root export or second public API is opened.

## Parity cases

1. Packed JavaScript graph: real workspace publish entries build, become
   tarballs, install offline, then the generic SDK root and Workbench Worker
   entries bundle from that installed graph. Artifact:
   `pnpm test:packed-toolchain-surface` aggregates the strict type and JavaScript
   branches; both are current-tree RED because runtime `./internal` is not
   published.
2. Packed public declarations: one strict positive and exact-negative
   TypeScript fixture checks the offline-installed declaration graph with
   `skipLibCheck:false`. Artifact: the packed command above is the RED target;
   `pnpm --filter @riftydev/sdk typecheck` and
   `pnpm --filter @riftydev/workbench typecheck` are preservation controls.
3. Publish source of truth: `pnpm sync:publish --check` and package-surface
   suites agree with tarball manifests and built files. Any hand-only manifest
   or tsup edit fails the sync check.

## Fault matrix

| axis × operation | honest outcome | reproducible artifact / fault target |
|---|---|---|
| `false-fallback` + `provenance-lie` × workspace→tarball resolution | fresh offline install and bundle resolve only tarball `exports`; missing subpath loud-fails, never falls back to source/workspace | Acceptance 1-3; packed JS/type RED |
| `sibling-drift` × dev/publish export graphs | sync authority emits the same declared internal entry into manifest, tsup JS and declarations; package surface checks reject one-sided edits | Acceptance 2, 6; `pnpm sync:publish --check`; package-surface tests |
| `lossy-aggregate` × public declaration exactness | positive exact results plus per-expression negative fields/types; no count-only or `skipLibCheck` pass | Acceptance 3-5; strict packed type carrier |

Evidence PACKED-RED (Node 24.16.0, pnpm 11.5.2, TypeScript 5.9.3,
esbuild 0.28.0):

```sh
pnpm test:packed-toolchain-surface
# real workspace closure built; 15 first-party packages packed; external
# dependency closure packed; offline npm install completed with no links.
# RED aggregates strict tsc and generic JS bundle:
# @riftydev/io dist/index.d.ts TS2417 Duplex static toWeb conflict
# @riftydev/kernel worker-entry declaration TS2304 DedicatedWorkerGlobalScope
# @riftydev/sdk dist/index.d.ts TS2307 @riftydev/runtime-js/internal missing
# ten exact-negative @ts-expect-error assertions unused because the unresolved
# SandboxToolchain declaration lost its discriminating shape
# esbuild rejects @riftydev/runtime-js/internal from both packed SDK root and
# packed Workbench no-COI Worker graphs
```

## Out of scope

- No Vite identity, version, callback, path, type, lifecycle or semantic
  obligation. Vite remains only a representative browser oracle in the
  successor build-loop.
- No toolchain runtime behavior, npm/network acquisition, build artifact,
  capability report, host lifecycle or Chromium acceptance; those remain the
  blocked build-loop.
- No new SDK method, package root export, runtime owner, protocol, cache,
  callback, retry, queue or lifecycle mechanism.

## Decisions

ready-verdict: 2026-09-01 — Contract+RED @ d1a0dd2ee

review: checkpoints — cross-package JS/declaration distribution boundary; user
requires fresh Contract+RED and Final+GREEN.

predecessor: `distribution/no-coi-sandbox-build-loop`

- `ready-verdict: 2026-09-01 — Contract+RED @ f0066d4d2`
- `contract-red: 2026-09-01 — blocker @ 326f5b70e`
- `contract-red: 2026-09-01 — blocker @ 2f1063608`
- `final-green: 2026-09-01 — blocker @ 07d370651`
- `final-green: 2026-09-01 — blocker @ bcff49986`
- `final-green: 2026-09-01 — blocker @ 541c4cd6c`
- Split is the user-authorized Contract-escalation resolution. It narrows the
  first slice, not the goal: packed JS/types land before the unchanged build
  behavior.
- Fresh challenge premise blocker is closed by the narrowed package-import
  user story; no runtime execution value is claimed by this child.
- Expected RED batch: packed SDK root JS graph; packed Workbench Worker JS
  graph; strict declaration graph; exact negative public shapes. Existing
  packed evidence already proves the missing runtime internal subpath.
- `contract-red: 2026-09-01 — blocker @ 65f581bc0`
- Contract+RED find 3 blockers + fresh tail 1 new blocker; independent
  adjudication 4 HOLDS. One re-cut batch fixes command reachability and exact
  negative directives, and removes self-imposed workspace-consumer parity;
  packed Acceptance 1-6 is unchanged.
