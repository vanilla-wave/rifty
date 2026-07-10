# ADR 0216: Install tail latency: background command durability, generation-guarded stamps, learned-pin SWR

Status: Accepted
Date: 2026-07

> TL;DR: `npm install` exit stops awaiting the OPFS durability drain — the
> drain→gate→stamp→drain sequence (ADR-0187 Corrected semantics intact) runs
> in background behind a pending-first, generation-guarded stamp, trading the
> durable-on-exit UX (ADR-0187's command-site decision, superseded here) for a
> bounded self-heal window; learned pins gain a serve-stale-while-revalidate
> tier (≤24h, extends ADR-0194 §8) with `savedAt` writable ONLY from
> server-vouched resolutions; npm-client grows the supporting public API
> (`resolveEddyClosure`, `InstallResult.resolvedAt`/`resolvedVia`).

## Context

Epic `install-tail-latency` (user-approved 2026-07-10). Floor profiling
(2026-07-01..05) put ~490ms of the visible `npm install` exit path on the OPFS
durability drain, and the learned-pin hard 30-min TTL re-paid a foreground POST
(~1–2.7s) to usually rediscover the same closure.

ADR-0187 decided the opposite trade for the command site: "npm install returns
only when tree + stamp are durable: npm parity, reload-safe", after an earlier
drain-drop was empirically refuted by `owner-snapshot-restore-exec` (immediate
reload lost the install — the restore clobbered the user's tree). That
refutation showed the REAL hazard is not the loss of the last ~0.5s of writes
(real `npm install` exit does not fsync `node_modules`; a power cut loses the
same tail on native Node) but a reload TRUSTING state that was never proven:
the boot's stamp check re-ran arrival against a stamp that attested a tree the
drain never confirmed. ADR-0187 itself already holds the answer for the boot
path — pending-first stamps that are never trusted until a clean drain
promotes them.

ADR-0194 §8 fixed learned-pin freshness at 1800s (server mutable-tier default)
with expiry = hard drop. The pinned `GET /bundle/<hash>` is content-addressed,
immutable, and was proven byte-stable live next-day — so re-paying a
foreground POST at 30min buys no correctness for the common unchanged-closure
case; env pins (ADR-0195 §5) already serve a deploy-time resolution
indefinitely.

## Decision

1. **Command-site durability goes background** (supersedes the "returns only
   when durable" clause of ADR-0187; every OTHER ADR-0187 decision — the
   checked-drain gate, full-ledger scoping, FIFO contract, boot pending
   stamps — stands). `npm install` resolves after link/shims/lockfile; the
   unchanged drain→gate→stamp→stamp-drain sequence runs un-awaited.
   Dirty-drain/stamp warnings surface asynchronously on the terminal.
2. **Pending-first + generation-guarded command stamps** (the boot path's
   pattern applied to the command site) keep every reload TRUST-safe:
   - at tree-mutation start the install demotes any trusted stamp to
     `durability:"pending"` (never satisfies reuse) — a reload during the
     install OR its background drain re-arrives instead of trusting a
     half-replaced tree; a failed install leaves it pending (the tree may be
     part-mutated — the old stamp must not resurrect);
   - each install bumps a per-tree GENERATION (module scope, cross-terminal);
     a background sequence writes its trusted stamp only while its generation
     is current — a newer install cancels the older sequence's stamp instead
     of racing it. Deliberately NOT an await-chain: chaining would park every
     later install behind a wedged durability layer (unbounded-wait class);
   - the trusted stamp attests the INSTALL-TIME deps + slug snapshot, never a
     post-drain re-read (an edit or preset switch inside the drain window must
     not leak into a trusted stamp).
3. **Accepted UX delta** (the epic's explicit call): a reload landing inside
   the ~0.5–2s background window may cost a re-install (for a from-scratch
   preset boot line, the clean-start wrapper re-seeds the preset
   `package.json`) — self-heal, never a crash, never a trusted torn tree.
   `owner-snapshot-restore-exec` is re-scoped accordingly: the survives-reload
   claim now waits for THIS install's stamp before reloading, and a separate
   fast-reload case pins "boots + serves, no crash" for the raced window.
   Measured install→vite-ready (eddy path, local, n=5 median):
   3429ms → 3072ms.
4. **Learned-pin SWR** (extends ADR-0194 §8; freshness semantics change is
   recorded HERE): ≤1800s fresh (unchanged); 1800s–24h STALE — still served
   via the pinned GET (install AND boot prefetch) with a terminal honesty line
   `npm: eddy cached resolution (as-of <resolvedAt>), refreshing in
   background` (`resolvedAt` = the SERVED manifest's validated stamp) and ONE
   background manifest-only POST revalidate (`resolveEddyClosure`, bounded by
   the ADR-0201 chokepoint, early-cancelled after the first tar member — no
   wire-protocol change); >24h hard drop (foreground POST exactly as before).
   The 24h bound caps the npm-unpublish/malware exposure; the operator safety
   net is the verified revocation runbook (`docs/public/hosting-eddy.md`).
5. **`savedAt` moves only on server-vouched resolutions.** A GET/prefetch
   cache serve NEVER rewrites the pin (the pre-existing write-back would let
   any install repeated within 30min self-renew an arbitrarily old closure
   forever, voiding the bound): the fire-and-forget write-back now fires only
   for `resolvedVia:'post'` adoptions, and the stale revalidate refreshes
   (same hash) or replaces (new hash — only with the `x-eddy-store-durable`
   proof, mirroring the installer's learnable gate) the pin.
6. **npm-client public API** (cross-package, recorded here):
   `InstallResult.resolvedAt` (validated ISO stamp of the adopted bundle),
   `InstallResult.resolvedVia: 'prefetch'|'get'|'post'` (attempt provenance —
   hash equality cannot distinguish a cache serve from a POST that recomputed
   the same closure), and `resolveEddyClosure()` (manifest-only POST resolve
   summary: `{closureHash, resolvedAt, storeDurable}`).
   `EDDY_STORE_DURABLE_HEADER` moves to `eddy-request.ts` (one wire-protocol
   home, two consumers).

## Consequences

- The install prompt returns ~0.5s earlier and a `&&`-chained dev server
  starts immediately; repeat installs of a ≤24h-old dep set ride the
  browser-HTTP-cached GET at replay speed with one background POST.
- A tab killed (or reloaded) before the background drain settles costs a
  re-install on next boot — bounded, visible, self-healing; never a torn tree
  behind a trusted stamp. The pre-existing mid-install torn-window
  (`playground/install-stamp-invalidation`) is NARROWED by the pending-first
  demotion (previously a reload during a bare re-install could trust the old
  stamp over a half-replaced tree).
- A failed install now leaves a pending stamp (next boot re-arrives) instead
  of resurrecting the pre-install trusted stamp — strictly safer: the failed
  install may have part-mutated the tree.
- The stale window is a deliberate, bounded npm deviation: a no-lockfile
  `npm install` may serve a ≤24h-old resolution, said out loud in the
  terminal, converging in background, with `prefer:'online'` and the
  revocation runbook as escape hatches.
- ADR-0187 keeps governing everything but the command-site await (amendment
  pointer added there); ADR-0194 §8's freshness clause is extended by §4–5
  here (pointer added there).
