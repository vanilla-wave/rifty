---
area: npm-client
status: draft
title: npm 11 bin reify lifecycle authority
created: 2026-07-28
why: rifty's provisional shared-command rule generalizes lexical package-name ownership across installs, but npm 11 ownership depends on reify action set, node depth, locale-sorted node path, and node_modules scope
user_story: As a browser-IDE user installing, adding, removing, or rebuilding packages that expose the same command, I want node_modules/.bin to select and retain the same launcher as npm 11, but today rifty's claimed lexical-min rule disagrees with ordinary packed-tarball installs
sources: [ADR-0335, docs/backlog/npm-client/reference/npm-11-bin-collision-probe.md, docs/backlog/npm-client/reference/npm-11-bin-collision-probe-output.json]
---

## Context

Observed path: install packed `a-a` + `a_a`, scoped contenders, or a nested
consumer; then add/remove one contender, repeat `npm install`, or run
`npm rebuild`. Node v24.16.0 / npm 11.17.0 produce different owners across
ADD/CHANGE, no-op, removal, and rebuild phases. Fresh/rebuild ownership follows
Arborist depth + English locale node-path order, not lexical package-name
minimum. Root and nested bin scopes settle independently.

ADR-0335 supersedes the recipe-v2 predecessor's disproven
lexical-min/every-install generalization. Until the exact lifecycle becomes an
accepted contract and implementation, collision handling must fail loudly with
`NotImplementedError('npm-client.bin-collision-reify')`, not publish a
plausible wrong launcher.

Classification: external-oracle `frozen-assumption` + `observable-order`; no
new coordination mechanism. The committed executable uses ordinary packed
tarballs, pins runtime and source-library hashes, records a nested-scope case,
and reproduces the golden byte-for-byte.

Dedup searched backlog titles, `code:`, epic Items, and child links. No durable
match found beyond the now-disproven `shadow-recipe-v2-authority` predecessor
and its provisional active-goal `shadow-materialized-bin-authority` split;
neither owns npm reify lifecycle as an independent contract.
