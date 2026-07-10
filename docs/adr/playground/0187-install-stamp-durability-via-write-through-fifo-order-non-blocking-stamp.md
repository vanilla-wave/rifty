# ADR 0187: Install-stamp durability via write-through FIFO order plus verified stamps

Status: Accepted
Date: 2026-07

> Amended (2026-07-10, epic `install-tail-latency`): the command-site
> "returns only when tree + stamp are durable" clause is superseded by
> ADR-0216 — the drain→check→stamp→drain sequence now runs in BACKGROUND
> behind a pending-first, generation-guarded stamp (this ADR's boot-path
> pattern applied to the command site). Every other decision here — the
> checked-drain gate, full-ledger scoping, FIFO contract, boot pending
> stamps — stands.

> Corrected (2026-07-04, PR #107 round 10; tightened round 21): FIFO order alone does NOT deliver "durable stamp implies durable tree" — per-op persist failures (quota/perm) were swallowed, so a failed tree write + a succeeded stamp write can stamp a torn tree. Fix: `OpfsFsSync` keeps a per-path persist-failure ledger (healed by a later successful persist of the same path); `flush()` still never rejects but now RETURNS the ledger report. The visible `npm install` gates the stamp on a clean tree drain (drain→check→stamp→drain; wall-cost ≈ the single drain — the post-stamp drain only waits for the stamp's own write) and warns loudly + skips the stamp on a dirty one (self-heal: no stamp → next boot re-installs). The boot/restore stamp stays non-blocking by first writing a PENDING stamp (`durability:"pending"`) that never satisfies reuse. A fire-and-forget post-boot drain promotes it only after a clean tree+stamp report; tree damage discards it, and stamp-file damage leaves it pending/untrusted. A crash/reload before promotion re-runs arrival instead of trusting an unproven tree.

> TL;DR: FIFO order is necessary but not sufficient: the tree drain must be CHECKED before writing a trusted stamp, then the stamp itself must drain. Boot/restore stays non-blocking via pending stamps; a deferred clean drain promotes only the same dep-set it stamped. The visible `npm install` command uses drain→check→stamp→drain — npm parity says the tree is on disk when the command returns (e2e-pinned: install survives an immediate reload).

## Context

ADR-0135's stamp invariant — a durable stamp implies a durable tree — was delivered by a blocking double-flush (`stampInstalledTree` in `npm-shell-command.ts`, `stampTree` in `project-deps.ts`): drain the whole write-through queue, write the stamp, drain again. Profiled 2026-07-01: that drain costs ~490ms on the visible `npm install` critical path (thousands of serial OPFS writes), and the snapshot-restore path pays the same before the dev line. Meanwhile the sync-mirror write-through (`OpfsFsSync.enqueuePending`, ADR-0072) is strictly FIFO: the stamp's own write-through, enqueued after the tree's, cannot complete before them. The dev-server child reads the tree over fs RPC from the in-memory mirror — OPFS durability is not on its data path.

An earlier revision of this ADR dropped the drain from BOTH sites. The `owner-snapshot-restore-exec` e2e refuted that for the command site: `npm install cowsay` → immediate reload lost the install (the queue had not drained; the restore correctly fell back to the baked snapshot, clobbering the user's tree). Real npm's contract is stronger than crash-consistency — when the command exits, the files exist; a user reloading right after a completed install must keep it.

## Decision

- **Boot/restore stamp (`stampTree`, `project-deps.ts`): non-blocking PENDING → trusted.** The boot path writes a pending stamp for the exact package.json dep-set and starts the dev line immediately. `installStampSatisfied` rejects pending stamps, so a reload before the deferred drain completes re-runs dependency arrival. The deferred drain promotes to a trusted stamp only after a clean report and unchanged deps; tree damage or dep drift discards it, and stamp-file failures leave it pending/untrusted. *(Corrected round 14: `flush` RETURNED to the options — but as the never-awaited seam of the deferred durability check above, not a boot-path drain; the ~0.5s stays saved.)*
- **Command stamp (`stampInstalledTree`, `npm-shell-command.ts`): drain→check→stamp→drain.** The tree drain is checked against the persist-failure ledger before writing a trusted stamp; the second drain proves the stamp write. `npm install` returns only when tree + stamp are durable: npm parity, reload-safe. Wall-cost ≈ the old single post-stamp drain because the second drain waits only for the stamp.
- The FIFO itself is a recorded contract: `enqueuePending` order is load-bearing (comment at the site + a RED-on-parallelize pin in `opfs-sync.test.ts` — inverted-latency writes must complete in call order). Reload-critical drains are untouched: the dev-ready drain (`devServerChild.boot({flush})`), the eval-boundary flush, project-index and starter-baseline flushes.

## Consequences

- Instant-preset restore returns ~0.5s earlier via pending stamps; `npm install` still waits for a checked tree drain plus stamp drain and stays durable-on-exit (`owner-snapshot-restore-exec` pins install-survives-reload).
- A reload during a boot-restore's drain window finds no trusted stamp → arrival re-runs (correct, visible, idempotent). *(Corrected 2026-07-04 and tightened round 21: FIFO order rules out a stamp landing BEFORE the tree, but a swallowed per-op persist failure could still leave an unproven marker; pending stamps close that crash window because they are never trusted.)*
- Parallelizing the write-through queue now requires an explicit stamp barrier — the vfs FIFO pin fails loudly if attempted naively.
