---
area: npm-client
status: draft
title: One package-tree authority — FIFO + claim commit protocol behind the frozen boundary
created: 2026-07-23
why: split epoch/readiness/admission ownership produced the #160 nested-cwd blocker; ADR-0309 consolidates the installed-tree lifecycle into one owner, and with ADR-0307 in force it consolidates far less (no tree-epoch surveillance)
epic: honest-shadow-substitutions
blocked_by: [npm-client/shadow-registry-core]
sources: [ADR-0307, ADR-0309, PR-160, PR-167-review]
code: [packages/workbench/src/glue/install-stamp-authority.ts, packages/workbench/src/glue/npm-shell-command.ts, packages/workbench/src/glue/project-deps.ts, packages/workbench/src/glue/owner-vfs-client.ts, packages/workbench/src/workers/owner-vfs-authority.ts, packages/workbench/src/workers/owner-package-state.ts, packages/workbench/src/glue/install-stamp.ts, tools/shadow-registry/src/esbuild-contract-probe.ts]
---

## Context

Slice `package-tree-authority` (see epic §Budget). One owner for package FIFO,
ADR-0261/0307 claim commit protocol, readiness publication, and child
reservation (readiness → synchronous spawn → supervision; no timeout-released
reservations). Replaces implementations BEHIND the registry-core slice's
frozen boundary contract, keeping its tests green unedited.

Contract+RED must use the PRODUCTION owner composition and cover: `cd sub &&
npm install` with exact Node package-tree ancestry; trusted/snapshot/
fresh-install/post-tree-failure paths; mutation during readiness; close during
install; reservation commit/abort; confirmed child termination; the
bare-authority vs production-owner sibling sweep (the quarry blocker's class),
including torn readiness publication. Whether facts are per install root or
composed by ancestry is decided by this contract, not assumed.

The series' slice-6 reliability deletion/collapse pass rides here: delete
read-deadline ladders, replay/duplicate ledgers, double SHA framing,
post-ensure rereads, split-ownership compensators once the Contract+RED proves
them unreachable; keep every real-boundary check (network SRI/caps, strict
codecs, OPFS receipt chain + read-back SHA of actual stored bytes, port-client
deadline + downward cancel, origin-wide Web Lock, FIFO reservation).

PR #167 review capture deduplicated into this item:

- **Two fallback stamp owners.**
  `packages/workbench/src/glue/npm-shell-command.ts:199-202` keys
  `installStampAuthorityFor` by `deps.vfs`;
  `packages/workbench/src/glue/project-deps.ts:108-113` keys the same WeakMap
  (`packages/workbench/src/glue/install-stamp-authority.ts:110-129`) by
  `opts.fsSync`. A bare
  composition over one logical store can therefore acquire independent
  root-local FIFO/epoch authorities. Current product reachability was checked:
  `packages/workbench/src/workers/owner-package-state.ts:177-181,272-274`
  creates one stamp/package authority, then injects that package authority into
  restore (`:491-500`) and terminal npm (`:624-628`), so the split is not
  reachable from today's production user path.
  Keep the attempted repro recorded; Contract+RED must remove the fallbacks or
  prove one canonical injected identity rather than point-keying both.
- **Worker VFS mechanism cascade.**
  `packages/workbench/src/glue/owner-vfs-client.ts:148-245` owns commit replay
  every 250 ms plus receipt/cleanup retry maps; `:345-377` completes the
  release/cleanup handshake.
  `packages/workbench/src/workers/owner-vfs-authority.ts:443-547` separately owns
  duplicate admission, retained terminals, and cleanup. This is a live
  dedicated-Worker boundary: while alive it is ordered/exactly-once, so
  lost-then-replayed and duplicate-delivery machinery protect physically
  excluded faults. Slice 6 explicitly owns deleting/collapsing this
  replay→dedup→retained-terminal→three-way-receipt cascade; peer death/epoch and
  honest terminal settlement remain.
- **Third synchronous SHA-256 core.**
  `packages/workbench/src/glue/install-stamp.ts:83-163` copied the one-shot
  browser-safe implementation from
  `tools/shadow-registry/src/esbuild-contract-probe.ts:407-488`;
  `packages/runtime-js/src/builtins/crypto.ts:590+`
  is a third, streaming guest-crypto implementation, while the other repo hash
  helpers are async WebCrypto or Node-only. The sync stamp compare is
  user-reachable on reopen. Consolidate the identical one-shot copies behind a
  layer-correct package-internal primitive + shared fixed-vector suite, or
  record why separate implementations are intentional; do not land copy four.

Refine before pickup (`rifty-refine`).
