# ADR 0187: Install-stamp durability via write-through FIFO order (non-blocking stamp)

Status: Accepted
Date: 2026-07

> TL;DR: stop draining the OPFS write-through around the install stamp (flush → stamp → flush); the FIFO write-through queue already lands the stamp after every tree write, so "durable stamp implies durable tree" holds while `npm install` / snapshot-restore stop paying the ~490ms+ blocking drain.

## Context

ADR-0135's stamp invariant — a durable stamp implies a durable tree — was delivered by a blocking double-flush (`stampInstalledTree` in `npm-shell-command.ts`, `stampTree` in `project-deps.ts`): drain the whole write-through queue, write the stamp, drain again. Profiled 2026-07-01: that drain costs ~490ms on the visible `npm install` critical path (thousands of serial OPFS writes), and the snapshot-restore path pays the same before the dev line. Meanwhile the sync-mirror write-through (`OpfsFsSync.enqueuePending`, ADR-0072) is strictly FIFO: the stamp's own write-through, enqueued after the tree's, cannot complete before them. The dev-server child reads the tree over fs RPC from the in-memory mirror — OPFS durability is not on its data path.

## Decision

Drop the blocking flushes from both stamp sites; the stamp write itself (in-memory + enqueued write-through) is all that remains on the critical path. The invariant moves to a recorded contract: `enqueuePending` FIFO is load-bearing (comment at the site + a RED-on-parallelize pin in `opfs-sync.test.ts` — inverted-latency writes must complete in call order). `NpmShellCommandDeps.flush` and `EnsureProjectDepsOptions.flush` are removed. Reload-critical drains are untouched: the dev-ready drain (`devServerChild.boot({flush})`), the eval-boundary flush, project-index and starter-baseline flushes.

## Consequences

- `npm install` and instant-preset restore return ~0.5s+ earlier; the queue drains in the background at the same total cost.
- A reload INSIDE the drain window finds no stamp → the boot re-runs dependency arrival (correct, visible, degraded) — the same failure mode a mid-install reload always had; never a stamped-but-torn tree (FIFO: stamp lands last).
- Parallelizing the write-through queue now requires an explicit stamp barrier — the vfs FIFO pin fails loudly if attempted naively.
