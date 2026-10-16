# ADR 0526: Separate npm alias placement from registry identity

Status: Accepted
Date: 2026-10-13

> npm aliases retain the dependency key for placement; registry/cache and lock `name` retain the target.

## Context

PR 341 setup fails before agents start: cliui's `string-width-cjs`,
`strip-ansi-cjs`, `wrap-ansi-cjs` carry `npm:` specs. Registry lookup used the
alias name and raw spec. ADR-0042/0303 own placement; ADR-0451 owns overrides.

Oracle: Node v24.16.0, npm 11.17.0, original npm tarballs served over localhost;
`pnpm exec vitest run tests/integration/npm-alias.parity.test.ts` runs native
npm for every root/transitive/override scenario. Native lock keeps alias path,
target `name`, target version/resolved/integrity; manifest bytes keep target
name. Prefix case-insensitive; omitted target range means `*`.

## Decision

One effective request separates registry name/range from optional install
name. Live resolution, retained lookup, Eddy provenance and acquisition use
that authority. Pins retain install name and optional registry name; cache
and Eddy tarball harvest use registry name; lock writer emits npm's `name`
only for aliases. Alias target drift cannot reuse a same-version pin.

`npm:` override values retain the overridden edge's install name. Rifty
`name@range`/bare replacement extensions keep existing substitution semantics.
Range-less npm aliases use `*` independently of the original edge range;
this closes the recorded ADR-0451 divergence, without changing its version/
range reading or native-substitution policy.

Candidates:

- Reuse target name for placement: rejected by native root alias lock and
  cliui's simultaneous CJS/ESM identities.
- Rewrite the extracted package manifest/name: rejected by original archive
  bytes and Node resolution; aliases are distinct module instances.
- Separate two names at the existing shaping seam: selected; no new lock,
  ledger, scheduler or resolver.

## Consequences

Root/transitive/scoped aliases, case variants, omitted range, npm alias
user overrides, native-lock replay and offline cache replay proven. Invalid
non-registry alias targets remain loud.

Fresh highest-possible hoisting remains ADR-0042/0303's explicit limitation;
compare visible identity at every edge, exact paths on native lock replay.
Runtime getter-only `module.exports` in ansi-styles is a separate captured
failure (`backlog/runtime-js/cjs-getter-only-module-exports`).

## Corrections (active)

2026-10-13 — ADR-0527 supersedes target-name mismatch → metadata repair and
same-version wrong-target guard. Independent npm oracle keeps admitted names
without named installation intent. Alias paths, target cache identities,
range-less alias rules and rifty substitution extensions remain active.
