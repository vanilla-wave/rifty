---
area: npm-client
status: draft
title: npm package-bin normalization authority
created: 2026-07-28
why: a registry manifest bin key such as bad/name is sanitized to basename name by npm 11, while rifty silently drops it, so a real package can install successfully without its executable
user_story: As a browser-IDE user installing an npm package with non-canonical bin metadata, I want the same launcher names and targets npm produces, but today rifty can silently omit a command
sources: [npm-normalize-package-bin@5.0.0, npm 11.17.0]
code:
  - packages/npm-client/src/linker.ts
  - packages/npm-client/src/registry.ts
  - packages/npm-client/src/installer.ts
---

## Context

Observed while narrowing
`npm-client/package-bin-linker-authority`: rifty's generic `normalizeBin`
discards an object key containing `/`. npm 11.17.0 delegates the same manifest
to `npm-normalize-package-bin@5.0.0`, whose pinned source sanitizes the key to
its basename and normalizes target separators/path segments. Source SHA-256:
`5d5fb5cae6d9c04079c01e6e1978de69d19c77ff160f523df462d08bca44b2dd`.

Dedup searched backlog titles, `code:`, epic Items/children, and ADR text for
package-bin/manifest-bin normalization; no durable match exists. This is
outside `honest-shadow-substitutions`: its collision successor consumes
already-supported bin shapes and must not invent a stricter parser.

The user path is a normal registry install followed by invoking the omitted
command. The fault crosses untrusted manifest decode into disk launchers;
`corrupt-input`, `lossy-aggregate`, and `sibling-drift` apply. No new
coordination mechanism or tier raise is involved.

## Readiness blockers

- Commit a Node v24.16.0 / npm 11.17.0 differential covering string, array, and
  object forms; scoped names; slash, backslash, colon, empty and non-string
  keys/targets; basename collisions; and dot/traversal target normalization.
- Decide the exact typed ingress for npm's array form and prove registry,
  lockfile replay, and linker consume one normalized representation.
- Enumerate malformed shapes npm removes versus shapes rifty must keep as a
  named loud gap; no silent drop or security-boundary widening.

## Acceptance

- Fresh install and lockfile replay produce the same normalized command/target
  map and exact launcher bytes as the committed npm oracle for every supported
  manifest form.
- Normalization has one owner before collision preflight; public linking,
  install results, and lock facts consume the same map without a sibling
  parser.
- Unsupported shapes throw a named `NotImplementedError` and stay compat ❌;
  they never disappear behind a successful install.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| corrupt-input | every npm-removed, npm-sanitized, and unsupported shape has an explicit outcome | manifest mutation table |
| lossy-aggregate | normalized keys/targets and collisions retain exact observable bytes | fresh/replay differential |
| sibling-drift | registry ingress, lock replay, collision preflight, and launcher linking consume one representation | shared public-install cases |
