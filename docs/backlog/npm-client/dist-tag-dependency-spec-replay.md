---
area: npm-client
status: draft
title: "Dependency specs naming a dist-tag other than latest: npm resolves the tag and replays the lock pin; rifty is a loud ceiling"
created: 2026-10-17
why: Independent Final review of PR #375 (C1) saw `npm:is-fullwidth-code-point@stable` install fresh and then fail warm replay offline; the inline review widened it — the surface is every `"pkg": "<tag>"` spec, not aliases — and a warm replay online silently followed the moved tag where npm keeps its lock pin
sources: [docs/adr/npm-client/0527-retain-npm-alias-source-identity-until-named-install.md, docs/backlog/distribution/reference/pr-375-final-green.json, docs/public/compat/package-tooling.md]
code: [packages/npm-client/src/installer-sources.ts, packages/npm-client/src/installer-walk.ts, packages/npm-client/src/installer-lockfile-reader.ts, packages/npm-client/src/installer-dist-tag.parity.test.ts]
---

## Context

Native Node 24.16.0 / npm 11.17.0, localhost registry with `dist-tags
{latest: 1.0.0, next: 2.0.0}`, manifest `{"tagged": "next"}`: fresh `npm install`
pins 2.0.0; after the tag moves to 3.0.0, `npm install` with the lock keeps 2.0.0
and makes no registry request (Arborist `dep-valid`: a `tag` spec is satisfied by
any registry-resolved node). On `main` before PR #375 rifty threw
`No matching version for tagged@next` at first install. PR #375's alias repair
briefly let `createRegistrySource` consult `dist-tags[spec]`: fresh install then
matched npm, but `lockfileReuseDecision`/`lockfileCovers` recheck the spec as a
semver range, so the warm replay re-resolved online (3.0.0, lock rewritten) and
threw `npm-client.registry.packument` offline. Closed in the same PR as a named
ceiling: `NotImplementedError('npm-client.dependency-spec.dist-tag')` after the
packument read, before any tarball or lock write, for plain and `npm:` specs
alike — carrier `installer-dist-tag.parity.test.ts`, compat ❌ row.

## Next

Owner npm-client (`installer-sources`/`installer-walk`/`installer-lockfile-reader`,
plus the Eddy fast path). Trigger: a real manifest with a tag spec, or the next
dependency-spec unit. Pickup is parity-first against real npm: fresh resolve
through `dist-tags`; warm replay (lock present, online and offline, tag moved)
keeps the retained pin like npm; `updateNames` named install re-resolves the
tag (ADR-0504/0527 intent); aliases `npm:<name>@<tag>` ride the same rule.
Replay must recognise a tag spec without a second resolver or cache layer
(ADR-0527 candidates); rifty's semver subset must not misread a valid range as
a tag. The ceiling test flips to the parity rows when this lands.
