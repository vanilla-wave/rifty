---
area: net
status: active
title: Bound WebSocket frame + fragment-reassembly payload size (maxPayload → close 1009)
created: 2026-06-18
why: continuation frames accumulate into an unbounded buffer with no aggregate cap; a peer can grow memory without limit, where real `ws` closes 1009 at maxPayload (default 100 MiB)
sources: [PR#42 ws-honesty-audit ws-fragment-accumulation-unbounded, RFC6455 §7.4.1 (1009)]
---
## Context
`upgrade-socket.ts` `handleServerContinuation`/`handleClientContinuation` push every continuation chunk into `chunks` and `Buffer.concat` at FIN with no aggregate limit; single-frame payload length (parseFrame) is also unbounded. Real `ws` tracks cumulative payload vs `maxPayload` and closes 1009 ("Message Too Big") when exceeded. Today the writer is always trusted same-origin (external peers go through the native browser `WebSocket`, not parseFrame), so it is latent, not a live exploit — but it is a silent RFC deviation. A backlog `ws-upgrade-max-payload.md` was added then dropped during PR#42 review as out-of-scope; this restores it with the cumulative-fragment angle.

## Options / Next
Add a `maxPayload` (default 100 MiB, configurable) checked against single-frame length AND cumulative fragmented size; on exceed, close 1009 and destroy. RED test: a fragment sequence past the cap closes 1009. A loud throw is NOT right (would reject legitimate large messages) — a bounded 1009 close is the faithful behavior.

## Reversibility
REVERSIBLE — additive bound behind a configurable limit + regression test.
