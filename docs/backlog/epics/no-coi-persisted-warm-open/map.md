# Path — no-COI persisted warm-open

## Items

1. [distribution/no-coi-toolchain-persist-failures](../../distribution/no-coi-toolchain-persist-failures.md) — draft, first unblocked PICKUP; reject reported install/build persistence failures (I3). No dependency on a new warm-open API or handle cache.

Only the independently specifiable first unit is seeded. The remaining I3
preload boundary and I1/I2/I4/I5 remain below; RECHART compiles the next unit
when its technical question is resolved. Child readiness belongs to PICKUP.

## Direction

1. Reject install/build persistence failures; the existing preload-failure
   boundary also needs honest proof wherever I3 consumes it. Result: failures
   stop being reported as successful persistence.
2. Establish supported warm activation from prior installation authority.
   Result: reopen/build preserves installed edits without invoking repair.
3. Avoid redundant persistence during explicit install. Result: repair stays
   available without rewriting every unchanged dependency.
4. Reduce OPFS handle/root lookup work. Result: faster boot without stale file
   content or altered native handle behavior. Profile total reopen afterward.

## Open questions

All currently identified user-owned forks are resolved. These questions shape
the route, not the accepted outcome; none prevents goal readiness.

- What minimal compatible authority can validate and activate saved installations, including 0.6-era data, without changing their files? — owner: agent — inspect existing registry binding/lock/stamp owners; discriminate with upgrade/missing-proof probes; select public boundary by ADR before implementation.
- Which existing owner supplies the clean persistence/equality proof for install dedup without hiding ledgered directory failures or unreadable preload? — owner: agent — use real OPFS fault probes and the existing scheduler/stamp authority inventory; compile I3/I4 together where necessary.
- How can traversal/preload reuse handles across paired surfaces while preserving native invalidation and receiver semantics? — owner: agent — browser differential probe and ADR for any native wrapper; measure calls and timings before adopting the carrier.

## Existing owners

- [Unreadable preload](../../vfs/opfs-preload-failure-empty-bytes.md): remaining I3 obligation after the first unit; reuse this capture, do not duplicate it. Resolve its honest failure carrier before warm-activation/equality proof consumes preload bytes.
- [Directory healing](../../vfs/mirror-existence-guards-cannot-heal-ledgered-dirs.md): relevant I4 failure; existence alone is not durable proof.
- [Lazy preload](../../vfs/opfs-lazy-content-preload.md): separate content-loading strategy; I5 needs handle reuse, not lazy sync reads.
- [Cross-realm mirror coherence](../../vfs/opfs-sync-cross-realm-mirror-coherence.md): existing boundary; a clean own-worker flush never proves absence of foreign mutation.
- [Trusted-state primitive](../../vfs/trusted-state-primitive.md): gated generic extraction, not a required new framework for this goal.

## Out of scope

- PR #316's COI Workbench snapshot application/producer, namespace, orphan recovery, preview-prefix and budget surfaces; keep its separate ownership.
- Changing general fs.writeFile semantics, automatic dependency repair on open, or treating edited/deleted package bytes as a pristine-tree trust violation.
- New whole-project crash transactions, eviction protection, arbitrary concurrent-owner coherence, or automatic retries; existing gaps are not claimed repaired.
- A new offline-install promise after loss of the replay cache, lazy content loading, or a fixed latency guarantee derived from the downstream machine.
