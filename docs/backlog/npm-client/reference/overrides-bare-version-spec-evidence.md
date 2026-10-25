# Evidence — overrides-bare-version-spec (2026-09-23)

## Oracle

Host Node v24.16.0 / npm 11.17.0 (bundled npm-package-arg 13.0.2,
@npmcli/arborist 9.8.0, semver 7.8.4), public registry
`https://registry.npmjs.org/` (the host's own npm config points at a mirror;
the reproduction pins the public registry through npm's env config), isolated
npm cache.

```sh
npm_config_registry=https://registry.npmjs.org/ \
  node docs/backlog/npm-client/reference/overrides-bare-version-spec-probe.mjs \
  | cmp - docs/backlog/npm-client/reference/overrides-bare-version-spec-probe-output.json
shasum -a 256 docs/backlog/npm-client/reference/overrides-bare-version-spec-probe.mjs \
  docs/backlog/npm-client/reference/overrides-bare-version-spec-probe-output.json
```

Two consecutive runs produced byte-identical output (registry state of
2026-09-23; a later registry change — e.g. a new `vite` latest or `ms`
nightly — changes `registryFacts`, not the lock rows).
Contract+RED golden (probe `c92d65ce…`, golden `cb279fd0…`) was first
reproduced byte-identically by its own probe at IMPLEMENT, then the probe
gained a 40-value loose-grammar sweep and the `star-padded` /
`whitespace-only` installs; every certified row and `registryFacts` is
unchanged in the regenerated golden (two runs, `cmp`-identical).
Probe SHA-256 `c7460c1921a432bf267ac629987bd3c6189b5c0f33a8ad9eec6caf12d77dc64f`,
golden SHA-256 `20afeaedb877d4f91ff8c7030f461b73e746ee491b1e5d9da8337660e801cf93`.
2026-09-25 (PR #353 review, D-004): the probe no longer hard-codes the registry;
it reads npm's configured one (`npm config get registry`) and records it.
Re-run with the command above: every classify/install row identical to the
golden; only `registryFacts.vite.latest` drifted (8.3.0 → 8.3.1, registry
state). Probe SHA-256 now `a7353d2e59551174c1bca050a7dda323370a841983d193ac641c8453b341112f`; golden unchanged.

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
| ` * ` | range of `vite` `*` |
| ` ` (one space) | range of `vite` `''` |
| `>= 8.0.0` | range of `vite` `>= 8.0.0` |
| `>=8.0.0  <8.1.0` | range of `vite` `>=8.0.0  <8.1.0` |
| `~ 8.0.1` | range of `vite` `~ 8.0.1` |
| `^ 8` | range of `vite` `^ 8` |
| `~> 8.0` | range of `vite` `~> 8.0` |
| `~8` | range of `vite` `~8` |
| `8.x.x` | range of `vite` `8.x.x` |
| `8.X` | range of `vite` `8.X` |
| `8.*` | range of `vite` `8.*` |
| `x.x.x` | range of `vite` `x.x.x` |
| `^0.0.x` | range of `vite` `^0.0.x` |
| `8.0.0 - 9` | range of `vite` `8.0.0 - 9` |
| `8 - 9 \|\| ^10` | range of `vite` `8 - 9 \|\| ^10` |
| `<8.0.0-rc.1` | range of `vite` `<8.0.0-rc.1` |
| `8.0.x-beta` | range of `vite` `8.0.x-beta` |
| `8.0.16+build.5` | version of `vite` `8.0.16+build.5` |
| `8.0.16beta` | version of `vite` `8.0.16beta` |
| `8.0.016` | version of `vite` `8.0.016` |
| `v8` | range of `vite` `v8` |
| `=v8.0.16` | version of `vite` `=v8.0.16` |
| `v 8.0.16` | version of `vite` `v 8.0.16` |
| `>8 <=9` | range of `vite` `>8 <=9` |
| `<=8` | range of `vite` `<=8` |
| `<x` | range of `vite` `<x` |
| `^8.0.0 \|\|` | range of `vite` `^8.0.0 \|\|` |
| `\|\|` | range of `vite` `\|\|` |
| `1.2.3 foo` | range of `vite` `1.2.3 foo` |
| `foo \|\| 8` | range of `vite` `foo \|\| 8` |
| `foo *` | range of `vite` `foo *` |
| `foo * bar` | throws `EINVALIDTAGNAME` |
| `+1` | range of `vite` `+1` |
| `1.2.3*` | range of `vite` `1.2.3*` |
| ` latest ` | tag of `vite` `latest` |
| `next` | tag of `vite` `next` |
| `x.1` | tag of `vite` `x.1` |
| `1.2.3.4` | tag of `vite` `1.2.3.4` |
| `2fa` | tag of `vite` `2fa` |
| `v` | tag of `vite` `v` |

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
| star-padded | `{"ms": " * "}` | `node_modules/ms` 2.1.3 |
| whitespace-only | `{"ms": " "}` | `node_modules/ms` 2.1.3 |
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

## Grammar recognizer (ADR-0451 decision 5) — IMPLEMENT

npm-package-arg `fromRegistry` reads `semver.valid(spec, true)` /
`semver.validRange(spec, true)` (semver 7.8.4, `classes/range.js`: loose mode
drops tokens that are not comparators, a branch counts when one survives).
`packages/npm-client/src/semver-loose-range.ts` ports that recognizer.

```sh
npx tsx docs/backlog/npm-client/reference/overrides-bare-version-spec-grammar-fuzz.mjs <seed> 300000
{"semver":"7.8.4","seed":1,"count":300000,"ranges":67031,"unmodelled":0,"mismatches":[]}
{"semver":"7.8.4","seed":7,"count":300000,"ranges":67022,"unmodelled":0,"mismatches":[]}
{"semver":"7.8.4","seed":42,"count":300000,"ranges":67049,"unmodelled":0,"mismatches":[]}
```

Unmodelled (documented in the module): numeric components past
`Number.MAX_SAFE_INTEGER`, where semver throws; rifty reads a range, and both
installs fail:

```sh
node -e 'const r=require("module").createRequire(require("child_process").execSync("npm root -g").toString().trim()+"/npm/package.json");const npa=r("npm-package-arg");for(const v of ["9007199254740993","^9007199254740991"]){try{const s=npa.resolve("vite",v,"/tmp");console.log(JSON.stringify(v),s.type)}catch(e){console.log(JSON.stringify(v),e.code)}}'
"9007199254740993" tag
"^9007199254740991" EINVALIDTAGNAME
```

Mutant: the Contract+RED spike's handwritten grammar swapped in for the port
→ `overrides-npm-value.contract.test.ts` 8 failed | 85 passed on the widened
golden (`8.0.16beta`, `v 8.0.16`, `1.2.3 foo`, `foo || 8`, `foo *`, `+1`,
`1.2.3*` read as names; `x.1` read as a range).

## Edge-spec continuation (ADR-0451, ADR-0051) — IMPLEMENT

npm: `edge.js` `get spec` returns the override value; nothing else about the
edge changes (source SHA-256 above). Rifty's per-package policies read
`resolveEffectivePackageRequest().override`: ADR-0051's gate (`!override`,
`installer-sources.ts` replay + live), recipe admission (`source === 'user'`
→ no recipe, `internal/shadow/admission.ts`), baked redirects (user match
wins in `resolveOverride`). A parse-only fix makes every npm version pin a
substitution.

`npx vitest run packages/npm-client/src/installer-override-npm-value-policy.contract.test.ts`
(differential: `overrides: {N: V}` ≡ the dependent declaring `N@V`):
- BASE code (value misparsed as a name): 6 failed | 3 passed (`Failed to
  fetch packument 1.0.0: 404` vs `ENATIVEUNSUPPORTED`; the optional case
  passes — both skip).
- Parse-only spike (`/tmp` scratch, reverted): 7 failed | 2 passed — native
  required/range/optional/lock-replay install `native-bin` silently, esbuild
  `0.28.0` skips the recipe, `^0.25.0` skips `NotImplementedError('esbuild.version')`,
  bcrypt skips the baked redirect.
- Implementation: 9 passed.

## Rifty matcher vs node-semver on the classified ranges

`matchesRange` (unchanged) vs `semver.satisfies(v, range, {loose: true})`
over 0.0.1…10.2.0 (scratch, 2026-09-23) differ for: `~>8.0`/`~> 8.0`,
`8.0.0 - 8.0.16`, `8.0.0 - 9`, `8 - 9 || ^10` (hyphen), `^0.0.x`,
`8.0.x-beta`, `v 8.0.16`, `>8 <=9`, `<=8` (partial bounds: rifty `<=8.0.0`,
npm `<9.0.0-0`), `<x`, `^8.0.0 ||`, `||` (empty branch = any), `1.2.3 foo`,
`foo *`, `+1`, `1.2.3*` (loose-dropped tokens), and `*`/` * `/` ` for a
prerelease. Pre-existing for every dependency spec; ADR-0451 §Divergences.

## GREEN — IMPLEMENT

`npx vitest run` over the three carriers: 102 passed (57 before the grammar
sweep); `packages/npm-client services/eddy tools/shadow-registry`: 79 files,
1301 tests passed.
