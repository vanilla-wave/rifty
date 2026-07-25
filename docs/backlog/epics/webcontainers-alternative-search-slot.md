---
kind: epic
status: ready
title: Own the open-WebContainers-alternative search slot
created: 2026-06-28
value: A developer searching for an open/self-hostable WebContainers alternative finds rifty first, on a comparison where every rifty claim links to a tested status.
user_story: As a developer at the moment of license-wall intent searching "open source webcontainers alternative", I want one rigorous, verifiable comparison that proves rifty is the MIT/self-hostable/$0 option, but today no such page exists, rifty is on no alternatives list, and apps/landing is a single static page.
---

## Outcome

The de-risked, durable landing pad the launch points at and that keeps converting long after the HN spike: a technically un-discreditable WebContainers/Nodebox/CheerpX/rifty comparison plus permanent backlinks from the lists rifty is currently absent from. It wins the one slot incumbents structurally cannot occupy (open + self-hostable + $0), and it only works if every cell is link-backed to a TESTED status — the honesty is the moat. Mission anchor: developers blocked by proprietary/metered runtimes find a faithful, open one.

## User scenario

A developer hits a license/cost wall with WebContainers, searches "open source webcontainers alternative" or "self-hostable webcontainers", and lands on rifty.dev/compare → sees a 4-column capability+ceilings table where every rifty cell links to a published compat matrix or a named parity fixture, an honest shared-ceilings row (link-backed, not prose), and a dated "verified as of" per competitor → clicks through to play.rifty.dev or `npm i @riftydev/sdk`. The same audience finds rifty in awesome-wasm / awesome-wasm-runtimes. Done when 100% of compare-page rifty cells resolve to a live tested anchor (CI link-checker green), git + ts-LS are installable (or footnoted), and rifty is listed in ≥2 aggregators.

Aggregator/awesome-list submissions are OUTBOUND/confirm-first acts gated on the live, link-integrity-checked page — they are this scenario, not items.

## Items

- `toolchain-build/compat-matrix-test-result-sink` (existing, draft — clear path) — derive cell status from real test pass/skip state so a green cell can't sit over a skipped test; THE load-bearing integrity backbone. The compare page is blocked on it.
- `distribution/landing-compare-page` — the rifty.dev/compare route + canonical table + build-time link-integrity test.
Related (not owned here): `distribution/publish-git-and-ts-language-service` — the marquee git/ts-LS cells must be installable or honestly footnoted (owned by `open-auditable-launch`); `distribution/dependency-license-audit` — the "MIT + open" wedge is undercut by an unaudited transitive surface; the target persona may audit it.
