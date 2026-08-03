---
area: playground
status: draft
title: Measured cleanup after the shadow series — emitted-runtime reachability
created: 2026-07-23
why: the Workbench extraction left runtime-bearing symbols that no sealed package entry can execute, while stale owner and predecessor docs still describe authorities moved by the series
epic: honest-shadow-substitutions
sources: [ADR-0308, PR-160]
code: [packages/workbench/src/glue/bin-executor.ts, packages/workbench/src/glue/pty-protocol.ts, packages/workbench/src/glue/README.md, apps/playground/src/glue/README.md]
---

## Context

The current production-source closure counts type-only imports as reachability.
That correctly keeps shared protocol and executor types, but hides emitted
runtime in two files absent from every sealed `@riftydev/workbench` bundle:

- `glue/bin-executor.ts` still exports the superseded page-side
  `createBinExecutor`; the owner child executor has owned the real path since
  `f03ce1da0`, and production imports only request/handle/hook types;
- `glue/pty-protocol.ts` still emits envelope constants and direction
  classifiers consumed only by its own tests; production imports only frame
  types.

The planned CDP worker multiplexer is not a deletion candidate: none of its 23
quarry files entered the 226-file extraction map or current `main`. The former
blanket Workbench exemption for `tools/` is already narrowed to four exact
artifact/parity owners and guarded against `tools/unrelated.ts`. Owner gates
already cover 53-file Workbench workers and both 51/38-file glue directories;
`npm-client/src` has 21 production files and is below the strict `>30` bar. The
app glue README alone still assigns extracted transport code and excludes UI
state that the directory now owns.

## Acceptance

1. A build-graph gate starts from all seven package-manifest exports, compares
   esbuild runtime inputs with every direct production source, transpiles each
   absent source, and rejects any absent file with non-empty emitted runtime.
   It is RED on exactly `src/glue/bin-executor.ts` and
   `src/glue/pty-protocol.ts`; cleanup makes the list empty without allowlists.
2. Remove `createBinExecutor` plus its private `prepareRequest`/`spawn`
   dependency surface and obsolete unit suite. Keep the request, worker-handle,
   and lifecycle-hook types used by the real owner child executor. Preview hook
   tests drive the hooks directly instead of retaining a dead executor as a
   harness.
3. Remove the PTY envelope discriminator and page/owner runtime classifiers
   plus their test-only coverage. Keep the structured-clone frame types and
   their live compile-time consumers.
4. All seven sealed Workbench entry builds, package tests, typecheck, and the
   real-codebase architecture gate stay green. No public package export or
   runtime behavior changes.
5. Rewrite `apps/playground/src/glue/README.md` around its actual app-local UI,
   persistence, configuration, and seed integration; route page/owner
   transport and protocol ownership to `@riftydev/workbench`. Keep the other
   owner READMEs unchanged and add no below-threshold npm-client README.
6. Retire the terminal `shadow-recipe-v2-authority` predecessor after updating
   live drafts that still say it owns landed schema/projection authorities.
   Historical reference checkpoints remain; explicit outside-goal optional,
   peer, bin-reify, and same-cwd residuals remain linked to their own drafts.

## Parity cases

1. The seven manifest exports are the package's executable oracle: every
   runtime-bearing production source is present in at least one generated
   bundle; type-only source modules may be absent with zero emitted JavaScript.
2. Existing installed-bin and PTY flows remain byte/behavior unchanged through
   `createOwnerChildBinExecutor`, the live frame consumers, Workbench unit
   suites, and the epic's Chromium closing smoke.
3. Architecture fixtures continue to admit only the four exact
   artifact/parity owners and reject an unrelated tool deep-importing
   Workbench.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| sibling-drift | adding runtime to a type-only-reachable file without wiring it to a sealed entry fails | emitted-runtime reachability RED/GREEN gate |
| frozen-assumption | quarry-only CDP code is not narrated as a deletion and no new global tools policy is smuggled into the slice | extraction-map/history audit plus existing exact-owner architecture fixture |
| lossy-aggregate | production closure distinguishes emitted runtime from erased type edges instead of treating every import alike | two-file RED set, zero-file GREEN set, and seven-entry build graph |

## Out of scope

- A new global `tools/*`-to-browser-tier policy, broader private-import rule, or
  package layer. The historical Workbench blanket is already closed; a global
  rule would be a separate contract.
- Deleting quarry CDP worker multiplexing that does not exist on `main`, or
  deleting live type carriers merely to increase the diff.
- Changing PTY wire shapes, installed-bin execution, preview ownership, public
  package exports, or user-observable shadow behavior.
- New coordination, cache, registry, lock, runtime adapter, or compatibility
  surface.

## Decisions

- Reachability means emitted runtime reachable from the package's seven
  declared exports. Type imports keep source ownership but cannot justify
  unreachable JavaScript.
- The existing owner child executor and live PTY consumers remain sole runtime
  owners. Tests may invoke lifecycle hooks directly; a test-only production
  executor is not retained as a harness.
- Measured zeroes close candidates honestly: no CDP deletion, no second arch
  ratchet, and no npm-client owner README.
- The terminal recipe-v2 predecessor is process residue, not future work. Its
  landed clauses remain in ADR-0335, executable contracts, and historical
  reference evidence; unlanded clauses remain separate ordinary backlog.
