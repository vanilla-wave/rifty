---
area: npm-client
status: ready
title: Abbreviated (corgi) packuments
created: 2026-06-28
why: cold install fetches FULL packuments (express ~786KB each), bloating the metadata waterfall that is ~98% of cold-install wall-time; the abbreviated format is ~10-20x smaller and carries every field rifty actually reads
user_story: As a developer running a cold `npm install`, I want metadata fetches to transfer only install-relevant fields, but today rifty requests full packuments (READMEs, maintainers, every version's time/publisher) it never reads.
epic: cold-npm-install-speedup
sources: [https://github.blog/changelog/2024-07-09-leaner-npm-packument-metadata-contents/, https://www.npmjs.com/package/pacote]
code: [packages/npm-client/src/registry.ts, packages/npm-client/src/installer.ts]
---

## Context

`registry.ts getPackument()` issues a bare GET with no `Accept` header → the registry returns the FULL packument. rifty reads only: `versions` (keys), `dist-tags.latest`, per-version `dependencies` / `peerDependencies` / `optionalDependencies`, `bin`, `scripts`, `dist.tarball`, `dist.integrity`, and `cpu` / `os` (the ADR-0051 native gate, `installer.ts assertNativeSupported`). All of these are present in the abbreviated ("corgi") format `application/vnd.npm.install-v1+json`. `main` / `module` / `exports` / `type` come from the `package.json` inside the tarball, not the packument, so install does not depend on them. The CDN already emits `Vary: Accept` (ADR-0176), so corgi and full responses cannot collide in cache. This is exactly the document npm / pnpm / bun resolve against — but rifty's Fidelity rule requires proving the resolved tree is identical, not assuming it.

## Acceptance

- `getPackument()` sends `Accept: application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*` on every metadata request; the q-fallback degrades to a full packument on a registry that 406s the corgi type.
- A parity test installs express@^4 + eslint@^9 twice — once forced to full packuments, once abbreviated — and asserts byte-identical resolved output: same version pins, same `resolved` tarball URLs, same `integrity`, same `installPath` set / layout, same lockfile.
- Request count, ordering, and the serial request-ordered flat-slot claim (the `walkAndPin` determinism invariant) are unchanged: a test asserts the express-diamond layout (`ms@2.1.3` flat / `ms@2.0.0` nested under `finalhandler`) is identical full vs abbreviated.
- The ADR-0051 native gate still fires under abbreviated: a manifest with `cpu` excluding wasm throws `ENATIVEUNSUPPORTED` (the field survives in corgi).
- CHANGELOG line in `packages/npm-client`.

## Parity cases

- express@^4 resolved closure (versions, tarball URLs, integrity, installPaths) byte-identical full vs abbreviated.
- eslint@^9 resolved closure byte-identical full vs abbreviated.
- A dependency whose newest version is excluded by a semver range (not `latest`) resolves to the same version under abbreviated (the version-key set + `dist-tags` must match).
- A package carrying `cpu` / `os` constraints (e.g. an `@esbuild/*` platform optional) still trips the ADR-0051 native gate under abbreviated and is warned-and-skipped exactly as today.
- `dist.integrity` in the abbreviated doc equals the full-packument integrity (the `fetch-and-unpack` EINTEGRITY check stays green on the same bytes).

## Out of scope

- A registry that returns 200 corgi but DROPS a field rifty reads: rifty does NOT synthesize the missing field (no silent stub) — it surfaces the existing loud throw (`Packument missing version manifest` / `No matching version`). Conforming registries always include these; this names the boundary, it does not add a shim.
- Consuming any NEW metadata field — the set of fields rifty reads is unchanged.
- A code workaround for the known npm bug where a proxy serves the corgi Content-Type uncompressed — handled as deploy verification (see Decisions), `NotImplementedError` not applicable.

## Decisions

- Header is tolerant (q-values), not a hard `application/vnd.npm.install-v1+json`: a private/mirror registry without corgi degrades to full instead of 406-failing the install. REVERSIBLE (request header only, parity-gated) → CHANGELOG, no ADR; ADR-0163 / ADR-0176 already anticipated abbreviated packuments (`Vary: Accept`).
- Verify before/at merge that the Yandex Caddy/CDN proxy GZIPs `application/vnd.npm.install-v1+json` responses (known npm bug: served uncompressed on a Content-Type mismatch). If not, add the type to Caddy's gzip set — config, not code. This is in Acceptance, not deferred.
- No ADR: behavior-preserving (parity-proven identical tree), contract-stable.
