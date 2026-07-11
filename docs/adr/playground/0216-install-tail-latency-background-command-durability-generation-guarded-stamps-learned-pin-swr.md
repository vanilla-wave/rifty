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
     part-mutated — the old stamp must not resurrect). A demote that REVOKES
     a trusted stamp is PROVEN durable before the first tree write (r3;
     ADR-0194 r17 revoke-proof class): flush + full-ledger stamp-path check →
     durable-rm fallback → loud install ABORT — an unpersisted demote leaves
     OPFS trusting the old stamp over a torn mutation. Fresh/pending trees
     have nothing to revoke, so the fast path stays await-free (the exit path
     is background regardless — the proof sits at install START);
   - each install bumps a per-tree GENERATION — per (vfs, cwd), cross-terminal
     within one VFS; keying by path string alone false-shares across VFS
     instances (r3) —; a background sequence writes its trusted stamp only
     while its generation is current — a newer install cancels the older
     sequence's stamp instead of racing it. ALL stamp writes (pending demote,
     deferred trusted) serialize on a per-tree chain of bounded VFS writes,
     and the trusted slot re-checks the generation SYNCHRONOUSLY inside the
     chain (r3: the gen/vanish checks sat awaits away from the write — an
     older sequence could overwrite a newer install's pending stamp).
     Deliberately NOT an await-chain over the DRAIN: chaining would park
     every later install behind a wedged durability layer (unbounded-wait
     class). The FOREGROUND install phases (tree writes) DO serialize per
     tree — visible, user-interruptible work only;
   - the deferred writer skips its trusted stamp when the tree dir vanished
     meanwhile (`npm install && rm -rf node_modules` must not resurrect
     trust into an empty dir) and never mkdirs (r3: a deletion completing
     after the check now fails the write ENOENT — loud skip, not a
     resurrected dir holding only a stamp). Non-npm PARTIAL mutations of a
     stamped tree remain the pre-existing class owned by
     `playground/install-stamp-invalidation` — unchanged by this ADR;
   - the trusted stamp attests the INSTALL-TIME deps + slug snapshot — slug
     sampled at mutation START (r3: sampling after installFn let a preset
     switch mid-install re-key the old tree under the new slug), never a
     post-drain re-read (an edit or preset switch inside the install or drain
     window must not leak into a trusted stamp).
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
   recorded HERE): age < 1800s fresh (unchanged); 1800s ≤ age < 24h STALE
   (boundaries exact as coded) — still served
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
   proof, mirroring the installer's learnable gate) the pin. The revalidate's
   write is COMPARE-AND-SET against the served stale hash (r3): a slow
   background POST landing after a newer POST/`--prefer-online` re-learn is
   `'superseded'` — observed, no write, never a rollback.
6. **npm-client public API** (cross-package, recorded here):
   `InstallResult.resolvedAt` (validated ISO stamp of the adopted bundle),
   `InstallResult.resolvedVia: 'get'|'post'` (request-kind provenance — a
   prefetch counts as its underlying request, so an unpinned boot prefetch
   still teaches a pin; hash equality cannot distinguish a cache serve from a
   POST that recomputed the same closure), and `resolveEddyClosure()`
   (manifest-only POST resolve
   summary: `{closureHash, resolvedAt, storeDurable}`).
   `EDDY_STORE_DURABLE_HEADER` moves to `eddy-request.ts` (one wire-protocol
   home, two consumers).

Round-4 hardening (2026-07-11, review r4 — production semantics):

- **SyncMirrorVfs.writeFile no longer auto-mkdirs** (sibling-drift kill): the
  no-mkdir deferred-write guarantee was proven only on the strict MemoryVfs;
  production's lenient twin resurrected deleted trees anyway. Node `fs`
  parity now contracted across siblings (the npm-client linker mkdirs
  explicitly — unaffected).
- **From-scratch clean-start runs INSIDE the install phase lock**
  (`prepareInstall` seam): the wrapper's clear/reseed could raze a tree under
  another terminal's exclusive install. A PENDING stamp for this slug with
  session install activity is OURS (mid background-durability) — no clear, no
  package.json reset inside the drain window.
- **Boot promoter re-checks the stamp SYNCHRONOUSLY at its write**: the async
  read could resolve before a command-site demote landed — the stale read
  then promoted trusted right over it.
- **Demote never silently no-ops**: without package.json the pending demote
  falls back to the prior stamp's own dep snapshot (a vacuous durability
  proof over an un-demoted trusted stamp was the alternative). An ABORTED
  install restores the mirror's trusted stamp so a retry re-runs the proof
  (mirror/durable split).
- **Trusted stamp only when package.json provably did not move** since the
  install-time snapshot (the boot promoter's contract — supersedes the r1
  "stamp the snapshot regardless" reading): the real installer re-reads
  package.json after the eddy pin window, so a mid-install edit can put deps
  in the tree the snapshot never named. Moved → loud skip, next boot
  re-installs.
- **Pin write-back is CAS** (the revalidate-CAS sibling): baseline = the pin
  read at install start (`null` = absent); a slower install adopting an older
  resolution skips instead of rolling back a newer pin.
- **A pinned boot prefetch is forwarded only while its hash IS the current
  pin decision** — a pin expired past 24h (or replaced) must not ride in via
  the buffered GET with no as-of line.
- Revocation runbook: server RAM caches (mutable link + packuments,
  ≤`EDDY_TTL_SECONDS`) can re-seed a revoked closure from an ORDINARY client
  POST inside the TTL window — named in the runbook with the restart
  escape hatch.

Round-5 hardening + the mandatory 3+-round audit (2026-07-11,
`docs/process/fault-classes.md`):

- r5 fixes: demote+proof ordered BEFORE `prepareInstall` (a clear whose rm
  never persisted erased the mirror stamp while OPFS kept the trusted one);
  `prepareInstall` acts only at the project root (the lock is keyed by
  `ctx.cwd`); the unmoved-guard compares package.json BYTES, never the
  flattened dep map (`lossy-aggregate` — boot-side flat compare is
  pre-existing, recorded in `playground/install-stamp-invalidation`); pin CAS
  compares the SERVABLE view (a hard-expired raw entry read as absent must
  lose to an expect-absent relearn); runbook: env pins have no age gate — a
  revoked bundle's env-pin GET rides browser caches up to a year, affected
  `VITE_RIFTY_EDDY_PINS` must be rotated + redeployed; `resolvedVia:'post'`
  is SERVER-VOUCHED (may be the mutable-tier cached resolution ≤TTL), only
  `prefer:'online'` guarantees recomputation.
- Audit by axis: `torn-state` recurred r1→r5 (generation → phase lock →
  chain/demote-proof → promoter recheck/prepare-in-lock/mirror-restore →
  prepare order). Admitted gap: ITEM CONTRACT — the bg-flush item's fault
  matrix listed rows per KNOWN writer but never the writer-set invariant
  ("every stamp transition through one serialized authority"); the structural
  kill (one stamp-authority chokepoint melting npm-shell-command ×
  project-deps × prepare writers) is NOT delivered by this epic — each
  boundary is individually proven instead, and the next stamp writer added is
  one review round away (bounded pragmatism, said loudly).
  `concurrent-same-key` recurred ×3 on pins (revalidate → write-back →
  expiry-view) because the r3 sweep was instance-scoped; the class now lives
  at ONE chokepoint (`writeLearnedPinExclusive` owns every compare).
  `sibling-drift` (lenient `SyncMirrorVfs.writeFile`): admitted gap — TOOLING:
  app-layer Vfs impls sit outside the packages/vfs contract suite; a shared
  cross-impl suite is the full kill (contract test added here).
  `lossy-aggregate`: new axis row added to fault-classes.md.

## Consequences

- The install prompt returns ~0.5s earlier and a `&&`-chained dev server
  starts immediately; repeat installs of a ≤24h-old dep set ride the
  browser-HTTP-cached GET at replay speed with one background POST — in trees
  WITHOUT a covering lockfile (fresh project/sandbox of a known dep set): a
  covering lockfile takes the zero-network replay fast path and never
  consults eddy (`hasLockfileFastPath`), which is faster still. Same-tree
  repeats are lockfile replays; the SWR pin serves the fresh-tree case.
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
- Honest residual: the from-scratch FIRST install still awaits the
  generated-baseline absorption's global flush before the prompt returns —
  pre-existing, outside this epic's install→vite-ready claim (which measured
  the repeat/visible-install path); removing it is future perf work, not a
  silent promise of this ADR.
