---
area: playground
status: draft
title: Can a baked snapshot satisfy zero-read replay without shipping the same package bytes twice?
created: 2026-08-31
why: every baked snapshot carries its substituted package both unpacked in the tree and whole as a tarball in the replay cache, and stores all of it as base64 inside JSON — on the three committed artifacts that is 3.77 MB of duplicate plus 2.54-4.71 MB of encoding tax a first-time user downloads
user_story: As a browser-IDE user opening an instant template, I want to download it once, but today the artifact ships one package's bytes in two representations and encodes every byte at a 33% expansion before compression.
sources: [PR-289, docs/adr/playground/0346-baked-dependency-snapshots-carry-replay-tarball-cache.md, docs/adr/npm-client/0371-registry-twins-carry-substituted-runtime-bytes-in-the-installed-tree.md, docs/backlog/playground/baked-snapshot-regeneration.md]
code:
  - packages/workbench/src/glue/dep-snapshot.ts
  - apps/playground/tools/bake-dep-snapshots.ts
---

## Question

A snapshot must restore an exact tree AND let the next `npm install` replay
with zero registry reads (ADR-0346). Today it buys the second guarantee by
shipping the package's tarball beside the very files that tarball unpacks to,
and stores both as base64 in JSON. Two independent questions, cheapest first:

1. Does the artifact need base64-in-JSON at all, or can the same content ride a
   binary container with no change to either consumer's contract?
2. Is one representation of the package enough — replay reading its bytes back
   from the restored tree, or a digest-addressed slot both consumers share — or
   is the duplication load-bearing (integrity is over the tarball, not the file
   set; re-packing at replay time may not be byte-reproducible)?

No carrier is prescribed. Whether re-derivation is exact enough for an
integrity-keyed cache is unproven and is the first thing a pickup must settle
if it goes past question 1.

## Context

Measured on the committed artifacts at `main` @ `afecdf1bf`:

```text
$ node -e 'const {gunzipSync,gzipSync}=require("zlib"),{readFileSync}=require("fs");
  for (const f of ["vite","vite8","typescript"]) {
    const p=`apps/playground/public/snapshots/${f}-node-modules.json.gz`;
    const j=JSON.parse(gunzipSync(readFileSync(p)));
    console.log(f, readFileSync(p).length,
      j.tarballCache.files.map(e=>e.path),
      j.nodeModules.files.map(e=>[e.path,JSON.stringify(e).length]).sort((a,b)=>b[1]-a[1])[0]);
  }'

vite       12221954  [ 5T/esbuild-wasm-0.28.0.tgz ]        [ esbuild-wasm/esbuild.wasm, 18558389 ]
vite8      18064987  [ St/lightningcss-wasm-1.32.0.tgz ]   [ lightningcss-wasm/lightningcss_node.wasm, 21134164 ]
typescript 19323110  [ 5T/esbuild-wasm-0.28.0.tgz ]        [ esbuild-wasm/esbuild.wasm, 18558389 ]
```

In each artifact the `tarballCache` entry is the archive the largest tree entry
unpacks from. Every entry is `encoding: 'base64'`.

**The pattern predates PR #289.** The pre-#289 `vite8` snapshot (`f9e3181c0`)
already carried `lightningcss-wasm/lightningcss_node.wasm` unpacked *and*
`St/lightningcss-wasm-1.32.0.tgz` — verified by decoding that blob. Double
carry is a property of ADR-0346 plus Pattern-1 registry twins; ADR-0371 added
the second instance (`esbuild-wasm`, now in two of the three artifacts), it did
not introduce the shape. Two packages double-carry today, not one.

Two measured, independent savings:

| artifact | shipped | drop `tarballCache`, re-gzip | binary container instead of base64-in-JSON |
|---|---|---|---|
| vite | 12,221,954 B | 8,449,163 B (−3,772,791) | 9,680,650 B (−2,541,304) |
| vite8 | 18,064,987 B | — | 13,352,299 B (−4,712,688) |

The dedup column is an exact re-gzip of the same object with
`tarballCache.files` emptied. The encoding column re-gzips the same decoded
content as a concatenated binary container; it is a lower bound on what a
non-JSON envelope costs, not a proposed format.

Wire cost for a first-time user of the instant Vite 7 template moved from
~7.06 MB (3.21 MB snapshot + a separate 3.85 MB `esbuild-wasm` tarball request)
to 12.22 MB (snapshot only, zero registry requests) with ADR-0371 — but the two
savings above are available on every artifact regardless of that change.

Neither carry is removable machinery: ADR-0346 and the closed esbuild twin
recut contract both require zero-read replay, and the twin flows through the
ordinary package path by design. This is a representation question about the
artifact.

Related, not duplicate: `playground/baked-snapshot-regeneration` owns re-bake
cadence, freshness identity, and git-history growth of these blobs, and
explicitly deferred moving them out of git in 2026-06. It never asks what the
bytes inside one artifact cost a downloading user. A pickup on either should
name the other.

## Options or Next

- **Cheapest, no contract risk:** stop paying the base64-in-JSON tax. Same
  content, binary envelope; neither the tree writer nor the replay cache
  changes semantics. Measured floor above; needs a real format decision and a
  drift-gate update.
- Replay reads member bytes from the restored tree instead of a cached tarball.
  Blocker to check first: the lockfile pins SRI integrity over the tarball, so
  this needs an exactness argument the current model may not give.
- One digest-addressed byte slot both the tree writer and the cache reference —
  dedup inside the artifact, no change to either consumer's contract.
- Do nothing: the cost scales with the number of wasm-bearing substituted
  packages, today two.

## Reversibility

REVERSIBLE — snapshot format, bake script, and restore path each change
independently; no public API and no ADR is contradicted by asking.

## Decisions

- 2026-08-31, user (inline review of PR #289): worth optimizing, not now.
  Captured as a draft, deliberately unscheduled; no epic linkage.
- 2026-08-31, post-challenge corrections in `## Context`/`## Options`: the
  pre-#289 `vite8` double carry, the second double-carrying package, the exact
  3,772,791 B dedup saving, the base64 tax measurement, and the
  `baked-snapshot-regeneration` cross-reference were all added after the
  verdict. Verbatim challenge text stands per README §Challenge.

## Challenge

challenge: 2026-08-31 — 5 problems

The `why:` mis-dates the defect and the doc's central premise is wrong: the same double-carry already shipped before PR #289. The pre-289 `vite8` snapshot at `99122f041` carries `lightningcss-wasm/lightningcss_node.wasm` (15,850,559 B) unpacked in its tree *and* `St/lightningcss-wasm-1.32.0.tgz` (3,821,302 B) in `tarballCache` — the pattern is a property of ADR-0346 plus Pattern-1 twins, not something ADR-0371 introduced.

The stated bound "the cost is bounded by the number of wasm-bearing substituted packages, today one" is false on the committed artifacts. Two packages across three artifacts double-carry today: `esbuild-wasm` in `vite` and `typescript`, `lightningcss-wasm` in `vite8`, whose dedup saving I measure at 3,828,918 B — larger than the Vite one the doc built its case on.

The impact is sized against one of three artifacts and the doc says so ("only the Vite artifact was opened") while still asserting the TypeScript claim as "almost certainly". Verified: TypeScript does carry the identical pair, and `vite8` — the largest artifact at 18,064,987 B and never mentioned — carries a different one, so the doc's cost table understates the real gap it is arguing about by roughly a factor of three.

A materially cheaper direct authority exists and the doc dismisses it in half a clause ("bake-time recompression") without sizing it. Every member is `encoding: base64` inside JSON (250/250 in `vite`); re-gzipping the same content as a binary container yields 9,682,812 B vs the shipped 12,221,954 B — 2,539,142 B recovered on `vite`, 4,708,619 B on `vite8`, 5,267,471 B on `typescript` — with no SRI-exactness argument, no change to either consumer's contract, and none of the ADR-0346 risk the item's first two options must clear. The doc's own "unavoidable" residual after dedup is almost entirely this tax.

The item's only quantitative claim is left as an admitted estimate ("the exact saving of removing it is unmeasured") when one `gzipSync` call settles it: the true Vite saving is 3,772,791 B, not ~3,845,798 B. Against a queue where `docs/backlog/playground/baked-snapshot-regeneration.md` has tracked committed-snapshot size pressure since 2026-06-13 (and explicitly deferred the storage move), this doc neither cites that item nor explains why a third overlapping size concern should exist separately from it.
