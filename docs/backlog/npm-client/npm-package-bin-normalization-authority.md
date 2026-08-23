---
area: npm-client
status: ready
title: npm package-bin normalization authority
created: 2026-07-28
why: a registry manifest bin key such as bad/name is sanitized to basename name by npm 11, while rifty silently drops it, so a real package can install successfully without its executable
user_story: As a browser-IDE user installing an npm package with non-canonical bin metadata, I want the same launcher names and targets npm produces, but today rifty can silently omit a command
sources: [npm 11.17.0, @npmcli/package-json@7.0.5, npm-normalize-package-bin@5.0.0, ADR-0364]
code:
  - packages/npm-client/src/package-bin.ts
  - packages/npm-client/src/linker.ts
  - packages/npm-client/src/registry.ts
  - packages/npm-client/src/installer.ts
---

## Context

Observed while narrowing
`npm-client/package-bin-linker-authority`: rifty's generic `normalizeBin`
discards an object key containing `/`. npm 11.17.0 sanitizes that key to its
basename and normalizes target separators/path segments. Fresh evidence
corrects the original draft assumption: npm's active authority is
`@npmcli/package-json@7.0.5`, not the older standalone helper. The two differ
on canonical-key collisions and target colons; the committed differential pins
both sources and npm's real pack/install/replay path.

Dedup searched backlog titles, `code:`, epic Items/children, and ADR text for
package-bin/manifest-bin normalization; no durable match exists. This is
outside `honest-shadow-substitutions`: its collision successor consumes
already-supported bin shapes and must not invent a stricter parser.

The user path is a normal registry install followed by invoking the omitted
command. The fault crosses untrusted manifest decode into disk launchers;
`corrupt-input`, `lossy-aggregate`, and `sibling-drift` apply. No new
coordination mechanism or tier raise is involved.

## User scenario

A registry package publishes
`bin: { "bad/tool": "./bin/../tool.js" }`. In a browser IDE the user runs
`npm install` and then `tool`. npm 11 creates the `tool` launcher targeting
`tool.js`; current Rifty reports install success but omits the launcher because
it drops the slash-bearing command.

## Acceptance

- Fresh install, direct public linking, direct lock construction, and zero-
  registry lockfile replay produce the oracle's normalized command/target map
  for every supported manifest form. Fresh/replay Rifty launcher bytes are
  identical and retain ADR-0050's exact shim carrier for the npm-relative
  command/target identity.
- Normalization has one owner before collision preflight; public linking,
  install results, and lock facts consume the same canonical map without a
  sibling parser. Raw tarball `package.json` bytes remain untouched like npm.
- Unsupported shapes throw a named `NotImplementedError` and stay compat ❌;
  they never disappear behind a successful install.

## Reference contract

Node v24.16.0 / npm 11.17.0, active
`@npmcli/package-json@7.0.5/lib/normalize.js` SHA-256
`ba75d512103e404d6125fb658211069f3eb0db0d6687d499130cd86a2b817014`.
The executable oracle and golden are
`reference/npm-11-package-bin-normalization-probe.mjs` and
`reference/npm-11-package-bin-normalization-probe-output.json`; reproduce:

```sh
node docs/backlog/npm-client/reference/npm-11-package-bin-normalization-probe.mjs \
  | cmp - docs/backlog/npm-client/reference/npm-11-package-bin-normalization-probe-output.json
```

The golden also pins the following legacy
`npm-normalize-package-bin@5.0.0` pass (SHA-256
`5d5fb5cae6d9c04079c01e6e1978de69d19c77ff160f523df462d08bca44b2dd`)
and proves why it cannot be the sole oracle.

## Parity cases

1. Bare/scoped string forms derive the command from the package basename and
   root-normalize dot, slash, backslash, colon, absolute, and traversal target
   segments.
2. String arrays derive basename commands, preserve npm's non-monotonic map
   order, and collapse same-command entries to the recorded target.
3. Object keys sanitize slash/backslash/colon and empty/non-string entries;
   collision with an already-canonical key follows npm's in-place mutation
   result, not a clean-map last-writer approximation.
4. Absent, empty, falsy, primitive, and all-invalid object forms produce no bin
   map, exactly where npm removes them.
5. Fresh install and zero-registry replay expose the same canonical result/lock
   maps and exact launcher shims while preserving raw installed manifest bytes.
6. Commands that collide only after normalization enter the existing
   `npm-client.bin-collision-reify` preflight before VFS mutation.
7. A non-string array member throws the exact named Rifty ceiling before
   lock publication, linker mutation, or install success.

## Out of scope

- Non-string array members remain compat ❌ and throw
  `NotImplementedError('npm-client.package-bin.non-string-array-entry')`; this
  unit does not copy Node's host-specific `path.basename` TypeError text.
- Same-command package ownership lifecycle remains
  `NotImplementedError('npm-client.bin-collision-reify')` per ADR-0361.
- `directories.bin`, package lifecycle preparation, Windows launcher carriers,
  and npm package-json fields outside `bin` are unchanged.

## Decisions

- ADR-0364 selects one browser-safe package-private semantic copy of npm's
  active finite bin algorithm; no runtime dependency or public normalizer.
- Public raw ingress is string, readonly string array, or readonly object with
  unknown values. Installed results and written lock entries carry only the
  normalized readonly string map.
- npm-removed malformed forms remain removals. Only the oracle-throwing
  non-string array member stays a named loud Rifty gap.
- The prior absolute/traversal rejection rows in source, aggregation, and link-
  ingress contracts are re-cut to npm's rooted package-relative behavior;
  tar/install-path escape rejection is unaffected.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| corrupt-input | every npm-removed, npm-sanitized, and unsupported shape has an explicit pre-effect outcome | committed mutation table + named-gap fresh/replay/link rows |
| lossy-aggregate | normalized keys/targets and canonical-key collisions retain exact observable identity | npm probe/golden + exact result/lock/shim assertions |
| sibling-drift | registry ingress, lock replay, direct lock, collision preflight, and launcher linking consume one representation | shared public/install/replay cases against the same golden rows |
