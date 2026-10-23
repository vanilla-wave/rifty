---
area: distribution
status: ready
title: Produce Brotli dependency snapshots through the public Rifty API
created: 2026-10-23
why: Embedders need smaller dependency snapshots without maintaining an external recompression step; the current public producer emits only gzip.
user_story: As a Workbench embedder, I want Rifty to produce a Brotli snapshot for my Vite project, but today I must decode and recompress the producer's gzip myself.
sources: [docs/backlog/distribution/reference/brotli-snapshot-evidence.md, docs/adr/distribution/0386-publish-deterministic-dependency-snapshot-archives.md, docs/adr/distribution/0387-expose-caller-pinned-dependency-snapshot-production.md]
code: [packages/workbench/src/glue/dep-snapshot-producer.ts, packages/workbench/src/glue/dep-snapshot.ts, packages/workbench/src/glue/bounded-asset-fetch.ts]
---

## Context

User selected built-in Brotli production, after distinguishing it from a
recipe requiring the embedder to externally recompress gzip. The current
public producer's options contain no encoding choice and its compression
step unconditionally uses gzip (`code` above). This is a producer capability
gap, not evidence that the HTTP reader needs a new decoder.

A real Chromium probe against current source matched the same identity and
parsed a Vite snapshot over HTTP gzip and Brotli. Brotli quality 6 was
8,287,151 B versus gzip 9,770,964 B on that fixture (15.2% smaller). This is
one measured encoding pair, not a universal size ratio or project launch
proof. Commands, versions and limits: `reference/brotli-snapshot-evidence.md`.

HTTP decoding and browser encoding differ: Chromium's CompressionStream
rejects both `br` and `brotli`; Node v24.16.0 accepts `brotli`. A format-string
change alone does not supply the existing browser-compatible producer with
Brotli. No codec, dependency or Node-only producer has been selected.

## User scenario

An embedder uses the public Rifty producer with their Vite project's manifest,
npm v3 lockfile and registry, requests Brotli, and receives a ready-to-host
Brotli snapshot. They do not write a recompression script or provide a codec.
They configure their HTTP server/CDN for the representation, then open the
snapshot-backed project through Workbench and run its Vite program.

The compressed bytes decode to the same snapshot TAR and snapshotId as its
gzip representation (ADR-0386); existing pin, replay, identity and size checks
remain applicable. Existing gzip callers and browser-compatible production
remain supported (ADR-0387). The documented delivery path uses HTTP
Content-Encoding; server setup remains the integration's responsibility,
as explained before the user's choice.

## Boundaries

- Additive Brotli production; existing calls retain gzip behavior. No request
  to switch existing default output or deployment files was made.
- HTTP Brotli delivery with a supported gzip alternative. The recipe must
  explain representation headers, negotiation and caching; Rifty does not
  become the integration's HTTP server or CDN configuration manager.
- Raw `.tar.br` without HTTP decoding is not promised. The current reader
  returns identity mismatch for this input; the supported recipe must make
  the distinction explicit, not present it as a working download.
- Guest `node:zlib` Brotli, payload/cache deduplication, physical mobile-device
  performance, all-CDN certification and automatic migration of Playground
  deployment assets are outside this producer workflow. No such outcomes
  were requested; this does not weaken existing loader validation.

## Acceptance

1. Public producer accepts optional `encoding: 'gzip' | 'br'`; omission retains gzip. Returns `contentEncoding` with archive/identities. Unsupported encodings reject. → scenario
2. Brotli and gzip decode to identical TAR, snapshotId and installArtifactIdentity; repeated Brotli is deterministic for identical input. Native Node Brotli decoder reads output; original pin/replay rules remain. → ADR-0386
3. Node and Chromium produce Brotli through the root API without caller codec/recompression. Lazy bundled codec works with installed package assets. → scenario
4. Packed producer's real caller-locked Vite snapshot delivered with HTTP `Content-Encoding: br` opens through Workbench, builds/runs Vite and preserves existing HMR/saved-state proof. Gzip HTTP alternative remains usable. → scenario
5. README gives encoding choice, representation headers, negotiation/cache responsibilities and unsupported raw `.tar.br` distinction. → scenario

## Reference contract

Node v24.16.0 `node:zlib.brotliDecompressSync` independently decodes browser
and Node output; byte equality with native gunzip of the default representation.
Existing ADR-0386 TAR identity, ADR-0387 pins and ADR-0346 replay checks unchanged.
Codec probe: `/tmp/rifty-brotli-codec/probe.mjs` using `brotli-compress@2.2.2`,
quality 6, real committed Vite snapshot converted by current serializer:
27,831,808 decoded B → 9,253,244 B; 860 ms; JS inline-WASM entry 1,360,947 B.
Native decoder equality passed. Reproducible retained measurements follow in
`reference/brotli-snapshot-production-evidence.md`; no universal ratio promised.

## Parity cases

1. Real ms tarball public producer: gzip/Brotli/native decoding, stable identity and repeated bytes (`dep-snapshot-producer.test.ts`). → ADR-0386
2. Chromium public producer and HTTP reader: same native oracle, real loopback transport (`tests/browser-unit/brotli-snapshot-delivery.spec.ts`). → scenario

## Fault matrix

1. corrupt-input / producer: invalid encoding, unpinned output, corrupt registry tarball reject without emitting an archive. → scenario
2. corrupt-input + poisoned-cache / delivery: corrupted/truncated HTTP body rejects; valid wrong representation and undecoded raw Brotli mismatch; no trusted snapshot. → scenario
3. unbounded-read / delivery: encoded Content-Length and decoded body over the existing 128 MiB cap reject. Existing stall bounds remain. → scenario
4. quota-perm-fail / native encoder + network: refused WASM instantiation and HTTP 503 reject visibly; never substitute gzip while claiming Brotli. → scenario

## Out of scope

Raw Brotli decoding, guest node:zlib, CDN configuration management, default
migration, cache/payload deduplication and mobile performance remain outside
this unit; raw Brotli yields identity mismatch, not a supported download path.

## Decisions

- re-cut: 2026-10-23 — relocate unchanged Chromium carrier to browser-unit lane; unit CI intentionally has no browsers; RED authority retained from b185f741e — trace: none.

- ready-verdict: 2026-10-23 — Contract+RED @ b185f741ef636dcd590b75551275785ab591ef94; JSON on PR #387.

- 2026-10-23 — pickup: one existing unit, one PR; no epic split or destination expansion.
- 2026-10-23 — ADR-0546 selects lazy inline WASM and the additive representation contract; independent DEC-2 critic: clear, supersede only gzip/CompressionStream/no-dependency restrictions.

- 2026-10-23 — user: «хотелось бы чтобы rifty из коробки поддерживал Brotli тк он эффективнее в сжатии снэпшотов» — built-in production, no caller recompression/codec step.
- 2026-10-23 — rejected route: external gzip → gunzip → Brotli recipe alone — does not meet the selected built-in producer result.
- 2026-10-23 — preserve existing gzip behavior and producer host compatibility; API/codec/dependency decisions belong to PICKUP, no public contract is changed by this write-up.
- 2026-10-23 — the initial question-draft review covered only the unanswered fork; it is not reused as the final check of this settled scope.

## Challenge

challenge: 2026-10-23 — 2 problems

1. Само уменьшение HTTP-передачи не обосновывает новый API производителя или браузерный Brotli-декодер. ADR-0386 определяет identity по несжатым байтам; текущий загрузчик принимает TAR. Более дешёвый кандидат: штатный gzip → gunzip → предварительный Brotli → HTTP `Content-Encoding: br`. Его достаточность зависит от цели пользователя и воспроизводимого прогона.
2. Не установлена пользовательская граница: настроенная доставка меньшего снимка либо штатная возможность производить такие артефакты через публичный Rifty API. Исходный материал называет второе ответственностью библиотеки, но запрос refine не разрешает принять это архитектурное утверждение за выбранный scope.

Raw `.tar.br` без HTTP-декодирования — отдельный результат, необходимый лишь при соответствующем сценарии хостинга. Мобильные perf/RAM, поддержка всех CDN и Node `zlib` Brotli из данной цели не следуют.

Reception: the user explicitly chose built-in production after the cheaper
route and server-setup requirement were explained. Both premise objections
are resolved by that choice and the recorded reader probe. The original
verdict is retained verbatim; no raw-file, guest-zlib or mobile guarantee is
inferred. The final written result receives a fresh RDY-6 review.
