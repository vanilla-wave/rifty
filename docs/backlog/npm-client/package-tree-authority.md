---
area: npm-client
status: ready
title: One package-tree authority — FIFO + claim commit protocol behind the frozen boundary
created: 2026-07-23
why: split epoch/readiness/admission ownership produced the #160 nested-cwd blocker; ADR-0309 consolidates the installed-tree lifecycle into one owner, and with ADR-0307 in force it consolidates far less (no tree-epoch surveillance)
epic: honest-shadow-substitutions
blocked_by: [npm-client/shadow-registry-core]
sources: [ADR-0307, ADR-0309, ADR-0261, PR-160, PR-167-review]
code: [packages/workbench/src/glue/install-stamp-authority.ts, packages/workbench/src/glue/npm-shell-command.ts, packages/workbench/src/glue/project-deps.ts, packages/workbench/src/glue/owner-vfs-client.ts, packages/workbench/src/workers/owner-vfs-authority.ts, packages/workbench/src/workers/owner-package-state.ts, packages/workbench/src/glue/install-stamp.ts, tools/shadow-registry/src/esbuild-contract-probe.ts]
---

## Context

Slice `package-tree-authority` (see epic §Budget). One owner per root for
package FIFO, the ADR-0261/0307 claim commit protocol
(demote → mutate → flush → promote), readiness publication, and child
reservation (readiness → synchronous spawn → supervision). Replaces
implementations BEHIND the registry-core slice's frozen boundary contract.
The reliability deletion/collapse pass rides here — it has this named owner
(PR #167 review: the worker-VFS replay cascade lives in the workbench VFS
path; this slice claims its deletion explicitly).

## Acceptance

- One authority owns the complete installed-tree transition per root; every
  consumer (installer, snapshot restore, manifest edit, reset, bootstrap,
  adapter admission) calls its small operation interface and never observes
  internal state. `PackageRuntimeAssetPort`-shaped facades, duplicate
  readiness unions, and sequence/token compensators are absorbed, not kept.
- Single-owner keying closed (PR #167 review): the two fallback constructors
  keyed by different objects (`npm-shell-command.ts` by `deps.vfs`,
  `project-deps.ts` by `opts.fsSync`) cannot mint two authorities for one
  root — one acquisition path, injection mandatory or key unified; a RED test
  constructs the bare composition and proves the second authority is
  unobtainable.
- Contract+RED runs against the PRODUCTION owner composition (never a bare
  authority) and covers: `cd sub && npm install` with real-npm root-selection
  semantics; trusted / snapshot / fresh-install / post-tree-failure paths;
  mutation during readiness; close during install; reservation commit/abort;
  confirmed child termination; torn readiness publication; the
  bare-vs-production sibling sweep (the quarry blocker's class). Whether facts
  are per install root or composed by ancestry is settled by this contract
  (ADR-0309), recorded in the PR, not assumed.
- Reservation lifecycle: released only by commit or confirmed
  terminate/exit/port-death — never by a local timeout.
- Deletion pass executed with unreachability proof from the Contract+RED,
  enumerated in the PR: the owner-vfs commit replay loop (250 ms re-send),
  receipt/cleanup retry maps, duplicate admission + retained-terminal dedup,
  three-way receipt handshake collapse, read-deadline ladders, double SHA
  framing, post-ensure rereads, split-ownership compensators. Kept, each with
  its boundary row: peer-death/epoch settlement, honest terminal settlement,
  network SRI/caps, strict codecs, OPFS receipt chain + read-back SHA of
  actual stored bytes, port-client deadline + downward cancel, origin-wide
  Web Lock, FIFO reservation.
- Third synchronous SHA-256 copy consolidated (PR #167 review):
  `install-stamp.ts` and `esbuild-contract-probe.ts` share one layer-correct
  package-internal primitive + one fixed-vector suite, or an ADR records why
  they stay separate; no fourth copy.
- Registry-core's frozen boundary contract tests stay green, unedited.

## Parity cases

Oracle: real npm (probe method of ADR-0307 — run it, record versions); each
case a failing-test-first target:

1. Root selection: `npm install` from `sub/` with `sub/package.json` installs
   into `sub/node_modules`, root tree untouched; from a subdir WITHOUT its own
   `package.json` → pin real npm's prefix walk-up behavior exactly.
2. Interrupted install (abort mid-mutation): next `npm install` reconciles
   from lockfile to a correct tree — npm's idempotent-repair observable.
3. Extraneous writes during/after install never trigger repair or trust loss
   (ADR-0307, already pinned at open — extend the pin across an
   install→run→install sequence).
4. `npm install` in nested root while ancestor tree is stamped: ancestor claim
   demoted before mutation under its tree, re-promoted only by its own
   protocol (rifty claim semantics — no npm counterpart; differential test
   documents the delta).

## Fault matrix

Tier `production`; MessagePort excluded axes struck per §Boundary failure
models:

| Boundary × fault | Honest outcome |
|---|---|
| Crash/reload mid-install (torn multi-step tree write) | reopen finds no trusted claim → honest reinstall; no partial trust |
| Quota/flush failure at promote | promotion refused, loud; claim stays demoted; retry after user action |
| Close during install | acquisition waiter aborts; claim stays demoted; reopen honest |
| Child crash before reservation commit | reservation released on confirmed exit/port-death only; FIFO drains |
| Owner worker death | page-side inflight settles loud via peer-death/epoch; no replay on respawn |
| OPFS persist-failure ledger rows | surfaced with the honest storage class; no durable readiness fabricated |
| Cross-tab second Workbench | origin-wide Web Lock refuses honestly; no dual authority |

## Out of scope

- Tree-epoch surveillance of any kind — dead per ADR-0307; epochs exist only
  as promoter fences inside the claim commit protocol.
- Shadow-asset store internals — behind the frozen registry-core boundary.
- Executable adapter dispatch and activation — `esbuild-vite-cutover` slice.
- New coordination mechanisms — this slice only deletes/consolidates
  (epic §Budget: 0; §Class-kill).

## Decisions

- ADR-0309 owns the single-owner shape, the operation-interface rule, the
  facts-per-root-vs-ancestry deferral to this slice's Contract+RED, and the
  deletion/keep split.
- ADR-0307 owns the trust oracle (commit protocol + lockfile hash at open).
- ADR-0261 retained clauses own reserved-claim ingress and durable promotion.
- fault-classes §Boundary failure models owns which VFS-path machinery is
  physically unjustified (live dedicated-Worker port: no lost-then-replayed,
  no duplicates).
- The PR #167 review findings folded here (dual keying, replay cascade, SHA
  copy) are in-scope acceptance, not separate drafts.
