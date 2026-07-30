---
kind: epic
status: ready
title: WASI-in-browser — show the one uncontested capability
created: 2026-06-28
value: A developer sees, clicks, and runs rifty's one uncontested capability — a real compiled WASI guest sharing files with node:fs in a browser tab — and trusts it because every claim is auditable.
user_story: As a tool/WASM builder evaluating rifty, I want to click a preset and watch a file written by node:fs get read+rewritten by a real esbuild.wasm WASI guest, and run the same thing from my terminal in 30s, but today there is no WASI preset, no standalone WASI example, and no blog to host the article.
sources: [ADR-0316]
tier: works
---

## Outcome

Running a real compiled WASI-preview1 guest in-browser that shares files with
`node:fs` over one VFS is a 0→1 capability WebContainers, Nodebox/Sandpack,
TutorialKit and NodePod all lack — the single place rifty wins on capability,
not just licensing. The runner/syscalls and exact package conformance are
shipped; user-facing guest acquisition is the child work. This epic surfaces
the capability as a clickable proof, runnable example, and auditable article.
The trust differentiator is accuracy: esbuild is real WASI; `node:sqlite` is
sql.js WASM (NOT WASI) — never conflated. Mission anchor: faithful real
toolchains in the browser, provably.

## User scenario

A developer reads the WASI-in-browser article on rifty.dev/blog → clicks the
live "WASI" preset → sees the explicit exact preview1 package acquisition →
watches `/work/entry.ts` (written via node:fs) get read by esbuild.wasm as a
WASI guest and its output written back, visible to node:fs in the same tab →
clones the repo, runs `examples/standalone-usage/05-wasi`, and sees a file cross
the JS↔WASI boundary in under 5 minutes, no browser needed → audits every claim
against docs/public/compat/wasi.md (25 implemented / 8 partial / 13 honest
E_NOSYS) and finds zero drift. Done when the preset + example share the exact
ADR-0316 provenance fixture and output oracle, the article ships with zero
claims exceeding the matrix, and the comparison page (other epic) gains a
link-backed "real WASI guest + node:fs-shared VFS" row.

Cross-posting the article (Dev.to/Hashnode with rel=canonical) is an OUTBOUND act — this scenario, not an item.

## Invariants

<!-- Each false on `14b0dad99`: `presets.ts` ships 11 presets, none WASI-facing;
     `examples/standalone-usage/src` is 01–04; `apps/landing/src/sections` has
     no blog. Vite's zero-preview1-request proof is NOT an invariant here — it
     already holds (`tests/browser-unit/esbuild-network-measurement.spec.ts:67`)
     and a run must not close on it. -->

1. I1. Selecting the WASI preset triggers one observable network request for
   exact `@esbuild/wasi-preview1@0.28.0`; before selection no such request
   exists in the journey.
2. I2. A file written by `node:fs` is read by the esbuild.wasm guest through
   `path_open`, and the guest's output is written back and read by `node:fs` in
   the same tab — one VFS, both directions.
3. I3. The user-facing guest bytes are checked against the shared ADR-0316
   fixture (version, npm integrity, member size, member SHA-256) before
   execution; drift fails loudly ahead of `WebAssembly.compile`.
4. I4. `examples/standalone-usage/05-wasi` runs the same file round-trip in Node
   without a browser, sharing that fixture and output oracle with the preset.
5. I5. rifty.dev/blog serves the WASI post, and every syscall/capability claim in
   it matches `docs/public/compat/wasi.md` — esbuild as real WASI, `node:sqlite`
   as sql.js WASM and not WASI, nothing above the matrix.

## Items

1. `playground/wasi-preset` — **wasi-preset** — the clickable live proof (I1,
   I2, I3): explicitly installed exact package bytes doing a real `path_open`
   round-trip over the shared VFS, not the stdin transform pipe. Blocking for
   the article.
2. `runtime-wasi/standalone-wasi-example` — **standalone-example** — a
   Node-runnable `05-wasi` over a memory VFS reusing the preset's provenance
   fixture and output oracle (I4); the article's runnable code blocks.
3. `distribution/landing-blog-surface` — **blog-surface** — the rifty.dev/blog
   route plus the first (WASI) post, accuracy-pinned to compat/wasi.md (I5).
   Last: it quotes the two proofs above.

Related (not owned here): the WASI-over-shared-VFS capability row is added by `distribution/landing-compare-page` (the other epic's compare table).

## Decisions

- invariants-signoff: 2026-07-30 — user (I1–I5 drafted from this epic's
  ratified scenario + ADR-0316, each checked false on `14b0dad99`).
- ADR-0316 owns guest identity and provenance. Exact
  `@esbuild/wasi-preview1@0.28.0` is acquired only by explicit preset/example
  intent and checked against one shared version/integrity/size/SHA fixture.
- This guest is never Workbench esbuild activation, a checked-in blob, a baked
  snapshot, an alias/overlay, or a hidden fallback. The preset's separate
  request is observable; Vite's zero-preview1-request proof remains independent.
- `tier: works` (2026-07-30): the epic ships a demonstrated capability, not a
  storage/concurrency mechanism. Its one reachable fault axis — wrong or drifted
  guest bytes — is an invariant (I3) rather than a matrix; acquisition failure
  stays the ordinary install path's loud error, and nothing here survives a
  reload, so `robust`/`production` would add ceremony, not honesty.

## Budget

- scope implemented outside `ready` items: 0
- ready-contract edits after pickup: 0
- new coordination mechanisms: 0 — preset and example both go through the
  ordinary validating install; no second acquisition path
- generated globs: `docs/public/compat/**`, `**/generated/**`,
  `apps/playground/public/snapshots/**`

| slice | band |
|---|---|
| wasi-preset | 500–1200 |
| standalone-example | 200–600 |
| blog-surface | 400–1200 |
