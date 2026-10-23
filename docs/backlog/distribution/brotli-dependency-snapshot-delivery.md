---
area: distribution
status: draft
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

## Next

Owner: distribution maintainer. Trigger: implementation pickup of this item.
One reviewable producer capability, not an epic or a deployment migration.
Before implementation, compile the public representation contract and its
ADR-0387 amendment; choose/probe a codec that serves existing producer hosts,
record any new dependency decision, and measure its cost on representative
snapshot data. Exact options, metadata and encoding effort are agent-owned
implementation choices, not unresolved user questions.

Compile the real producer → HTTP delivery → Workbench/Vite proof, reference
interoperability and reachable corrupt/truncated/oversize/error outcomes at
PICKUP, with Contract+RED before product code. The saved probe only establishes
reader feasibility; it does not close that end-to-end acceptance. Keep this
item draft until its implementation contract and required preparation exist.

## Decisions

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
