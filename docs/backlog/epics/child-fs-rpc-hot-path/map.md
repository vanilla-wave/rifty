## Items

1. `perf/syncrpc-v2-waitasync-binary-ring` — **binary REQUEST frame residual**
   (I2) — re-cut; ADR-0084 delivered waitAsync + binary reply, ADR-0365
   delivered one-hop read heads on protocol v4; I3 baseline/post-I1 artifacts
   are its proof anchors.

## Open questions

- Unattributed ~7 µs/hop (dispatch, version checks, SAB→private `slice()`
  copies, ring state machine) — what would settle: instrumented ipc-bench on
  the product shape; only obvious removals qualify (fork B).
- Batched probe RPC (one hop per candidate set) — only if post-I1/I2 anchor
  numbers still show probe-storm dominance; new wire method → §Class-kill
  mechanism sweep before any contract.
- Loaded-owner effect: ipc-bench responder was idle; a busy owner may be
  worse — what would settle: rig run with owner under load.

## Out of scope

- Child-side content/stat caches or RPC bypass (fork C — strict ADR-0150
  freshness; never graduates without close + re-fit).
- Large-file (> `FS_RPC_CHUNK`) O(N²) read/write + base64 write inflation —
  stays `perf/fs-rpc-chunk-perf`.
- Guest install writes — eddy / install epics.
- Spawn floor + child environment cost (~2 s wall gap) — separate mission.
- Non-COI (same-realm fallback) path.
