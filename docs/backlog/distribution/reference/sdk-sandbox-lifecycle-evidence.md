# SDK lifecycle evidence — PR357

Authority: kit I1–I3, ADR-0486; BASE c4830dc642cefcef3ab1f60495b841126a14b75c.
Native Chromium, real runtime Workers/OPFS and genuine ms snapshot producer.
Fault injection only at native storage and HTTP boundaries.

RED2026-09-30: `RIFTY_NO_COI_PORT=5511 RIFTY_NO_COI_ORACLE_PORT=5512 RIFTY_NO_COI_RESOURCE_PORT=5513 pnpm test:no-coi sdk-lifecycle.spec.ts sdk-snapshot-progress.spec.ts`:
15 behavioral failures,4 controls GREEN,1.1min. No missing-import/type failures.
Log: `/tmp/rifty-pr357-sdk-red.log`.

- Early subscriber sees no events; current Promise exposes no runtime.on.
- Two actual native owners: both 5s host and 30s guard deadline cannot identify
  occupied. Existing guard prevents memory fallback. Waiting then released guard
  reaches held native HEAD read; no boot events, negative classification retained.
- Actual run/fs/install and restart overlap yield errors but no root classifier.
- Real producer archive applies under declared, HTTP content-encoded and chunked
  delivery; no byte/write/native flush events emitted.
- Snapshot mismatch/conflict/quota/resident failures occur but root classifier
  absent. Permission, unobserved timeout, HTTP404 and verified malformed envelope
  remain negative controls. Wrong unverified bytes are identity mismatch;
  verified malformed bytes are a parse error, never mismatch.

Mechanism sweep: host.ts already owns pendingRequests and current Worker peer;
SDK bootToolchainSandbox already owns its subscription Set. Lift that hub before
await, retain restart forwarding; snapshot frames reuse request.id and existing
peer guard. No new coordination owner. Counts originate bounded fetch, prepared
workspace overlay, OpfsFsSync.flush native watermark. No time-derived progress.

Additional baseline: no-coi-snapshot-application.spec.ts preserves identical bytes
and untargeted files under force. Same semantics remain, not blanket nonempty.

Native project file+command quota test separately RED1: effects still correctly
applied=yes/persistence=failed and live content command; only exported kind absent.
Log `/tmp/rifty-pr357-sdk-persistence-red.log`. SDK typecheck GREEN.

GREEN2026-09-30: lifecycle/snapshot/native baseline34/34 (1.1min), plus generic
opening/async-validation1/1. Real counts compared to separately observed native
OpfsFsSync.flush receipts; a constant persisted=total=1 payload mutant fails at
that comparison (restored automatically). Native held-fetch/restart rejects the
old apply and only replacement progress remains. Same-peer artificially delayed
frames remain source-guard evidence, not claimed as an executed mutant proof.
Logs `/tmp/rifty-pr357-sdk-green2.log`, `-generic.log`, `-flush-mutant.log`.

First pass19/20: Playwright fulfilled an encoded response without native HTTP
decoding, so the encoded fixture was wrong. Moved encoded delivery to a real
chunked Node HTTP server; browser decodes it. Added actual CORS hidden-encoding
case: compressed Content-Length is not a trusted decoded-byte total. Both visible
and hidden encoding omit total; raw same-origin declared length and chunked body
retain honest domains. No weakened byte assertion.

Existing SDK/runtime unit57/57; SDK+Workbench typechecks, refs/backlog/arch,
dir-owner/file-size pass. Full pr:check and independent Final+GREEN follow.

Full gate first26/27: only exact TypeScript-worker artifact pin stale after shared
chunk changes (docs/process/traps.md copied-asset-fingerprints). Unit222s and
parity119.3s GREEN, no isolated reruns. Reviewed emitted import graph; updated
only typescript-worker.js size10022664/SHA00545aee8a0a8a792277e38e752c1e05e5b6d00c546b86d5363722399a28f45b.
2MB ceiling and negative payload tests unchanged. Isolated retirement gate and
its10 adversarial tests GREEN; full gate repeated after exact-pin repair.

Full gate27/27 GREEN on product-identical ee5102411 (unit209.7s, parity118.6s),
no reruns: `/tmp/rifty-pr357-sdk-pr-check-final.log`. Actual packed toolchain
surface GREEN:15 first-party+72 external tarballs, strict TS, browser compiler
loading and real generic/toolchain/agent/build proofs. Log
`/tmp/rifty-pr357-sdk-packed.log`; satisfies ADR-0391 browser proof for exact pin.

Fault-model correction: an attempted native-timeout carrier correctly produced
no late counts (OpfsDrainScheduler excludes timedOut operations, ADR-0359).
A follow-up fixture reordered actual postMessage calls and killed a guard-removal
mutant, but this is physically excluded by rules/fault-classes.md's Worker row.
Independent reviewer corrected its own suggestion/acceptance. Removed that
artificial carrier; no product change. I3 retains actual peer-replacement proof
(held HTTP fetch/restart), operation-id separation and existing request guards.
No claim that an impossible transport fault proves shipped behavior.
