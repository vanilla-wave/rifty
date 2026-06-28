---
area: distribution
status: ready
title: rifty.dev/blog surface + first WASI post
created: 2026-06-28
why: the WASI-article channel (own-blog SEO-compounding + cross-post) has no implementation — apps/landing has no blog and no MD-rendering infra exists anywhere
user_story: As the maker publishing technical articles to compound SEO, I want a canonical rifty.dev/blog that renders my posts, but today there is no blog surface so the "own blog" channel is unbacked.
epic: wasi-in-browser-showcase
sources: [docs/public/compat/wasi.md]
code: [apps/landing/vite.config.ts, apps/landing/src/main.ts]
---

## Context

`apps/landing` is a static Vite SPA with no blog, no MD-rendering infra, no `/blog` route. The WASI epic's "own blog (SEO-compounding)" channel and "cross-post" tactic have nothing to build on.

## Acceptance

- A `rifty.dev/blog` route (an MPA input entry, the same hand-authored static pattern as `distribution/landing-compare-page` — NO new Markdown-parser dependency) renders the post(s) with title/date/canonical metadata.
- The first post (the WASI-in-browser article) ships and links the live `playground/wasi-preset` + the `runtime-wasi/standalone-wasi-example`.
- Every capability claim in that post matches `docs/public/compat/wasi.md` exactly: `node:sqlite` described as WASM (NOT WASI); syscall counts stated as 25 implemented / 8 partial / 13 `E_NOSYS`.
- A build-time link-integrity check covers the post's internal links.

## Parity cases

None — content/marketing surface, no Node-API behavior. Verification is the link-integrity check + a manual accuracy pass against `compat/wasi.md`.

## Out of scope

- No CMS / comments / RSS beyond a static post list (RSS optional, not required).
- No Markdown-parser dependency — hand-authored posts only (see Decisions).
- No claim exceeding `compat/wasi.md` (the auditability wedge dies on one over-claim).

## Decisions

- Canonical host = rifty.dev/blog (own surface for SEO compounding); cross-posts (Dev.to/Hashnode) use `rel=canonical` back to it.
- The first post is hand-authored as a static section/HTML module (the compare-page pattern) — NO new dependency, so the route itself is REVERSIBLE → CHANGELOG line in apps/landing; no ADR.
- A real Markdown-parser renderer (markdown-it/marked/remark/…) is a NEW dependency = IRREVERSIBLE → OUT OF SCOPE here; adopting one is a separate `pnpm adr:new distribution` item if/when posts outgrow hand-authoring.
