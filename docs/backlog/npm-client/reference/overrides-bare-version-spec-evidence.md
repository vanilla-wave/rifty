# Evidence — overrides-bare-version-spec (2026-09-23)

## Oracle

Host Node v24.16.0 / npm 11.17.0 (bundled npm-package-arg 13.0.2,
@npmcli/arborist 9.8.0, semver 7.8.4), public registry
`https://registry.npmjs.org/` (the host's own npm config points at a mirror;
the probe pins the public registry), isolated npm cache.

```sh
node docs/backlog/npm-client/reference/overrides-bare-version-spec-probe.mjs \
  | cmp - docs/backlog/npm-client/reference/overrides-bare-version-spec-probe-output.json
shasum -a 256 docs/backlog/npm-client/reference/overrides-bare-version-spec-probe.mjs \
  docs/backlog/npm-client/reference/overrides-bare-version-spec-probe-output.json
```

Two consecutive runs produced byte-identical output (registry state of
2026-09-23; a later registry change — e.g. a new `vite` latest or `ms`
nightly — changes `registryFacts`, not the lock rows).
Probe SHA-256 `c92d65ceefd8314e06b76dada136c0d6103b16d5b77846ee69ff9fd3828f7473`,
golden SHA-256 `cb279fd08616cdace810dd8391f1f28a155a4a971c60fbeef537d10ddc0ed9ec`.

## Mechanism (npm 11.17.0 sources)

| source | SHA-256 | fact |
|---|---|---|
| `@npmcli/arborist/lib/override-set.js` | `ad1f5a508110fada532a9d8d262fa568d1ab041199f33850f565075897237991` | :16 a `''` value becomes `*` |
| `@npmcli/arborist/lib/edge.js` | `a547398f1ac1dc19a57bc6bc3f4477baf7b2af34337518e15223aa7f35e34e81` | :205-229 `get spec` returns the override value for the edge's own name, except `*` (edge spec kept); `$name` reads the root manifest's dev/optional/dependencies |
| `@npmcli/arborist/lib/arborist/build-ideal-tree.js` | `a0b61513b68f538d070a3030ffc643d979d3d94ea9473dfce5d0049014cd45d1` | :1139 `npa.resolve(edge.name, edge.spec, …)` — the value is read against the EDGE name |
| `npm-package-arg/lib/npa.js` | `41cd09e778c4a7588df362588dbe9146a024d5cfcdf449702feb294e6acde761` | `fromRegistry` :461-471 `semver.valid(spec, true)` → version, `validRange(spec, true)` → range, else tag; `npm:` is split off before (alias) |
| `@npmcli/arborist/lib/node.js` | `50ba0586f3ffe89f3bc1214be213e2c3eba189b617e1e1b3bb25dd87aa43e991` | :1389-1398 `assertRootOverrides`: an override that changes a root direct dependency's spec throws `EOVERRIDE` |

## npm reading of override values (`classify`)

| value (key `vite`) | npm-package-arg reading |
|---|---|
| `8.0.16` | version of `vite` `8.0.16` |
| ` 8.0.16 ` | version of `vite` `8.0.16` |
| `v8.0.16` | version of `vite` `v8.0.16` |
| `=8.0.16` | version of `vite` `=8.0.16` |
| `8.0.16-beta.1` | version of `vite` `8.0.16-beta.1` |
| `^8.0.0` | range of `vite` `^8.0.0` |
| `~8.0.16` | range of `vite` `~8.0.16` |
| `~>8.0` | range of `vite` `~>8.0` |
| `8.0.x` | range of `vite` `8.0.x` |
| `8.x` | range of `vite` `8.x` |
| `8` | range of `vite` `8` |
| `x` | range of `vite` `x` |
| `*` | range of `vite` `*` |
| `>=8.0.0 <8.1.0` | range of `vite` `>=8.0.0 <8.1.0` |
| `8.0.0 - 8.0.16` | range of `vite` `8.0.0 - 8.0.16` |
| `^7.0.0 \|\| ^8.0.0` | range of `vite` `^7.0.0 \|\| ^8.0.0` |
| `latest` | tag of `vite` `latest` |
| `beta` | tag of `vite` `beta` |
| `bcryptjs` | tag of `vite` `bcryptjs` |
| `sql.js` | tag of `vite` `sql.js` |
| `7zip-bin` | tag of `vite` `7zip-bin` |
| `@scope/pkg` | directory path |
| `npm:vite@8.0.16` | alias → package `vite` version `8.0.16` |
| `npm:bcryptjs@2.4.3` | alias → package `bcryptjs` version `2.4.3` |
| `npm:bcryptjs` | alias → package `bcryptjs` range `*` |
| `npm:v8.0.1` | alias → package `v8.0.1` range `*` |
| `npm:8.0.16` | alias → package `8.0.16` range `*` |
| `npm:2` | alias → package `2` range `*` |
| `vite@8.0.16` | throws `EINVALIDTAGNAME` |
| `$vite` | throws `EINVALIDTAGNAME` |

## npm installs (`installs`, `npm install --package-lock-only`)

Manifests: `dependencies: {debug: "4.3.4"}` (debug 4.3.4 → `ms: "2.1.2"`)
plus the override; the scenario row is the goal manifest
(`devDependencies: {vitest: "4.1.11"}`). Full manifests and the npa reading
per row are in the golden.

| id | `overrides` | npm 11.17.0 lock / error |
|---|---|---|
| baseline | `—` | `node_modules/ms` 2.1.2 |
| exact | `{"ms": "2.0.0"}` | `node_modules/ms` 2.0.0 |
| v-prefixed | `{"ms": "v2.0.0"}` | `node_modules/ms` 2.0.0 |
| eq-prefixed | `{"ms": "=2.0.0"}` | `node_modules/ms` 2.0.0 |
| caret | `{"ms": "^2.0.0"}` | `node_modules/ms` 2.1.3 |
| tilde | `{"ms": "~2.0.0"}` | `node_modules/ms` 2.0.0 |
| x-range-patch | `{"ms": "2.0.x"}` | `node_modules/ms` 2.0.0 |
| partial-major | `{"ms": "2"}` | `node_modules/ms` 2.1.3 |
| x-any | `{"ms": "x"}` | `node_modules/ms` 2.1.3 |
| star | `{"ms": "*"}` | `node_modules/ms` 2.1.2 |
| empty | `{"ms": ""}` | `node_modules/ms` 2.1.2 |
| comparator-set | `{"ms": ">=2.0.0 <2.1.0"}` | `node_modules/ms` 2.0.0 |
| hyphen | `{"ms": "2.0.0 - 2.1.1"}` | `node_modules/ms` 2.1.1 |
| union | `{"ms": "^0.7.0 \|\| 2.0.0"}` | `node_modules/ms` 2.0.0 |
| tag-latest | `{"ms": "latest"}` | `node_modules/ms` 2.1.3 |
| tag-beta | `{"ms": "beta"}` | `node_modules/ms` 3.0.0-beta.2 |
| bare-word | `{"ms": "bcryptjs"}` | exit 1 `ETARGET`: notarget No matching version found for ms@bcryptjs. |
| digit-leading-word | `{"ms": "7zip-bin"}` | exit 1 `ETARGET`: notarget No matching version found for ms@7zip-bin. |
| alias-name-range | `{"ms": "npm:bcryptjs@2.4.3"}` | `node_modules/ms` `bcryptjs` 2.4.3 |
| alias-digit-name | `{"ms": "npm:2"}` | `node_modules/ms` `2` 3.0.0 |
| alias-v-name | `{"ms": "npm:v8"}` | `node_modules/ms` `v8` 0.1.0 |
| rifty-name-at-range | `{"ms": "ms@2.0.0"}` | exit 1 `EINVALIDTAGNAME`: Invalid tag name "ms@2.0.0" of package "ms@ms@2.0.0": Tags may not have any characters that encodeURIComponent encodes. |
| reference | `{"ms": "$ms"}` (deps {"debug": "4.3.4", "ms": "2.0.0"}) | `node_modules/ms` 2.0.0 |
| direct-dep-conflict | `{"ms": "2.0.0"}` (deps {"debug": "4.3.4", "ms": "^2.1.0"}) | exit 1 `EOVERRIDE`: Override for ms@^2.1.0 conflicts with direct dependency |
| existing-lock-then-override | `{"ms": "2.0.0"}` (added over a lock written without it) | `node_modules/debug/node_modules/ms` 2.0.0 |
| scenario-vitest-vite | `{"vite": "8.0.16"}` | `node_modules/vite` 8.0.16 |

Registry facts (`registryFacts`): `ms` dist-tags latest `2.1.3`, beta
`3.0.0-beta.2`; packages literally named `2` (3.0.0), `x` (0.1.2), `latest`
(0.2.0), `beta` (0.0.1) exist; vitest 4.1.11 declares
`vite: "^6.0.0 || ^7.0.0 || ^8.0.0"`; vite latest `8.3.0`.

Earlier cross-check: goal evidence §Oracle (2026-09-16) recorded the same
scenario lock (`node_modules/vite@8.0.16`).

## Rifty baseline — RED at BASE 325ae797c (vitest 2.1.9, Node v24.16.0)

`npx vitest run packages/npm-client/src/overrides-npm-value.contract.test.ts`
→ 18 failed | 11 passed. Every npm version/range value, `latest`, and the
parent-scoped `vitest>vite` key parse as a package NAME, e.g.
`expected { name: '8.0.16', range: null } to deeply equal { name: 'vite', range: '8.0.16' }`,
`expected { name: ' 8.0.16 ', range: null } …`; `'*'` yields
`override: { name: '*' }` / `effectiveName: '*'` instead of no override.
Passing guards: `npm:` aliases (target name even for `npm:8.0.16`/`npm:2`),
`vite@8.0.16`, ETARGET words (`bcryptjs`, `7zip-bin`) as rifty names, baked
`bcrypt → bcryptjs`.

`npx vitest run packages/npm-client/src/installer-override-npm-value.contract.test.ts`
→ 15 failed | 4 passed. Failures are the misparse itself:
`Failed to fetch packument 2.0.0: 404` (exact, existing-lock-then-override),
`v2.0.0`, `=2.0.0`, `^2.0.0`, `~2.0.0`, `2.0.x`, `*`, `>=2.0.0 <2.1.0`,
`^0.7.0 || 2.0.0`, `8.0.16` (scenario); the unrelated registry packages are
consulted for `2` / `x` / `latest` (`No matching version for 2@2.1.2`,
`x@2.1.2`, `latest@2.1.2`); `$ms` → `Failed to fetch packument $ms: 404`, not
`NotImplementedError`. Passing controls: baseline, empty value, rifty
`name@range` spelling (debug and scenario trees).

Browser shell, `RIFTY_PLAYGROUND_PORT=5401 npx playwright test
--project=chromium-heavy --workers=1 tests/e2e/npm-override-bare-version.spec.ts`
→ 1 failed. The rifty spelling `vite@8.0.16` installs and matches npm's vite
lock entries (`RIFTY-SPELLING-TREE-OK`); the npm spelling then prints
`npm: install failed: Failed to fetch packument 8.0.16: 404`, exit 1
(`Expected: 0, Received: 1` at the npm-spelling install).

Rifty semver matcher (unchanged by this unit), `npx tsx` over
`packages/npm-client/src/semver.ts` with versions 2.0.0…2.1.3:
`matchesRange('2.1.1', '2.0.0 - 2.1.1')` false, `'~>2.0'` false (npm: 2.1.1 /
range) — the hyphen/`~>` matcher gap of ADR-0451 §Divergences; `^2.0.0`, `x`,
`2`, `latest` → 2.1.3 as npm.
