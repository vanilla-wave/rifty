---
area: distribution
status: ready
title: Read and write standard dependency snapshot tar envelopes
created: 2026-09-08
why: Published dependency snapshots must be inspectable with ordinary archive tools without colliding with user filenames.
user_story: As an embedder, I want an ordinary tar.gz dependency snapshot whose file bytes restore unchanged.
epic: self-hosted-snapshot-workbench
blocked_by: []
sources: [docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/dep-snapshot-producer.md]
code: [packages/workbench/src/glue/dep-snapshot.ts]
---

## Context

First part of I1; producer and packed-browser proof follow in
`distribution/dep-snapshot-producer`. Existing v3 JSON/gzip remains readable.
The envelope has `payload/` and `rifty/` branches; manifest/lock and installed
files are ordinary entries, control metadata/cache never enter the project.
Reference and RED: `reference/dep-snapshot-tar-evidence.md`.

## Acceptance

1. Standard tar and raw gzip decode to the same dependency bytes, including nested, binary, long UTF-8 names and empty directories; user/control namespaces remain disjoint. `dep-snapshot-tar.test.ts` standard tar/gzip cases. → I1
2. Deterministic serialization produces ordinary extractable file entries, fixed metadata/timestamps and byte-stable ordering; existing uncompressed-content SHA-256 identifies raw gzip and HTTP-decoded tar equally. `dep-snapshot-tar.test.ts` writer and identity cases. → I1
3. Legacy v3 JSON/gzip and replay-cache integrity checks remain valid. `dep-snapshot.test.ts`. → I1

## Fault matrix

- Poisoned/truncated archive × decode: bad checksum, unsafe/duplicate/ancestor paths, unsupported types or control entries reject before destination effects. `dep-snapshot-tar.test.ts` poisoned-artifact cases. → I1
- Snapshot identity/replay integrity × restore: mismatched identity never admits bytes; absent/altered replay closure fails before mutation. Existing `dep-snapshot.test.ts` replay faults + new identity case. → I1
- Oversized compressed/decoded body × fetch: existing 128 MiB caps and typed fetch/decompress failure remain. Existing `bounded-asset-fetch.fault.test.ts` declared/streamed caps and `dep-snapshot.test.ts` typed fetch failure; decode uses the same bounded stream owner. → I1

## Out of scope

Public producer, packed browser, application policy and runtime deployment
remain the named successor units; no arbitrary installed-tree import.

## Decisions

ready-verdict: 2026-09-08 — Contract+RED @ 04bf115f294f9ebfbcc8388accf5202e9a36bf46

- re-cut: 2026-09-08 — split codec from distribution/dep-snapshot-producer; producer retains public bake/packed-consumer obligations and depends on this codec — trace: none
- 2026-09-08 — ADR-0386: standard envelope, strict input validation, legacy decode reuse; no new coordinator or external dependency.

## Challenge

challenge: 2026-09-08 — clear; inherits unchanged goal I1 premise.
