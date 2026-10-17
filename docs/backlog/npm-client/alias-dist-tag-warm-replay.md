---
area: npm-client
status: draft
title: "Alias with a non-latest dist-tag replays offline in npm; rifty re-resolves the tag"
created: 2026-10-17
why: Independent Final review of PR #375 (C1) — `npm:is-fullwidth-code-point@stable` installs fresh, but a warm-cache replay without a registry throws npm-client.registry.packument because the tag is checked as a semver range; native npm replays from the lock with zero requests
sources: [docs/adr/npm-client/0527-retain-npm-alias-source-identity-until-named-install.md, docs/backlog/distribution/reference/pr-375-final-green.json]
code: [packages/npm-client/src/installer-sources.ts]
---

## Context

ADR-0527 proves retained alias replay for semver and `latest` targets. The
reviewer's probe (detached scratch, Node 24.16.0 / npm 11.17.0; registry projection
with `dist-tags.stable`) shows: native `npm install` replay with the lock present
makes no registry requests; rifty's replay path treats `stable` as a range,
finds no satisfying retained pin and asks the registry for the packument —
`NotImplementedError('npm-client.registry.packument')` offline. BASE (origin/main)
rejected the alias at first admission, so this is a new surface, not a regression.

Owner: npm-client installer-sources (`updateNames`/replay range check). Pickup:
parity test against real npm for `npm:<name>@<tag>` with a non-`latest` tag
(fresh install, warm replay offline, lock bytes), then dist-tag resolution through
the retained lock entry. No new resolver or cache layer (ADR-0527 candidates).
