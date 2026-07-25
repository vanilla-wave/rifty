---
kind: epic
status: ready
title: WASI-in-browser — show the one uncontested capability
created: 2026-06-28
value: A developer sees, clicks, and runs rifty's one uncontested capability — a real compiled WASI guest sharing files with node:fs in a browser tab — and trusts it because every claim is auditable.
user_story: As a tool/WASM builder evaluating rifty, I want to click a preset and watch a file written by node:fs get read+rewritten by a real esbuild.wasm WASI guest, and run the same thing from my terminal in 30s, but today there is no WASI preset, no standalone WASI example, and no blog to host the article.
sources: [ADR-0316]
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

## Items

- `playground/wasi-preset` — the clickable live proof: explicitly installed
  exact package bytes doing a real path_open file round-trip over the shared
  VFS (not the stdin transform pipe). Blocking for the article.
- `runtime-wasi/standalone-wasi-example` — a Node-runnable `05-wasi` over a
  memory VFS using the same package-provenance fixture and output oracle; the
  article's runnable code blocks.
- `distribution/landing-blog-surface` — the rifty.dev/blog route the channel depends on + the first (WASI) post, accuracy-pinned to compat/wasi.md.

Related (not owned here): the WASI-over-shared-VFS capability row is added by `distribution/landing-compare-page` (the other epic's compare table).

## Decisions

- ADR-0316 owns guest identity and provenance. Exact
  `@esbuild/wasi-preview1@0.28.0` is acquired only by explicit preset/example
  intent and checked against one shared version/integrity/size/SHA fixture.
- This guest is never Workbench esbuild activation, a checked-in blob, a baked
  snapshot, an alias/overlay, or a hidden fallback. The preset's separate
  request is observable; Vite's zero-preview1-request proof remains independent.
