# Vite 8 Rolldown WASI runtime closure probe

Recorded 2026-07-28 on Node v24.16.0 / npm 11.17.0. Both npm installs used
the public registry, a fresh directory, `--os=wasi --cpu=wasm32`,
`--ignore-scripts --no-audit --no-fund --prefer-online`, and exact
`vite@8.0.16`.

## Real npm

Run once with this package.json:

```json
{"name":"vite8-oracle","private":true,"dependencies":{"vite":"8.0.16"}}
```

Then repeat in another fresh directory with:

```json
{"name":"vite8-alias-oracle","private":true,"dependencies":{"vite":"8.0.16"},"overrides":{"@napi-rs/wasm-runtime":"npm:@napi-rs/wasm-runtime@1.1.6"}}
```

Commands per directory:

```sh
npx --yes npm@11.17.0 install --os=wasi --cpu=wasm32 \
  --registry=https://registry.npmjs.org --ignore-scripts --no-audit --no-fund \
  --prefer-online
node -e "for (const name of ['vite','rolldown','@rolldown/binding-wasm32-wasi','@napi-rs/wasm-runtime','@emnapi/core','@emnapi/runtime']) console.log(name,require('./node_modules/'+name+'/package.json').version)"
NAPI_RS_FORCE_WASI=1 node --input-type=module \
  -e "await import('rolldown'); console.log('rolldown-wasi-ok')"
shasum -a 256 package-lock.json
```

Observed without the override:

```text
vite 8.0.16
rolldown 1.0.3
@rolldown/binding-wasm32-wasi 1.0.3
@napi-rs/wasm-runtime 1.2.0
@emnapi/core 2.0.0-alpha.3
@emnapi/runtime 2.0.0-alpha.3
Error: Cannot find native binding
3154e46fe53db673408f35be8970703f9733e05abd6132a0f14e8650574bb615  package-lock.json
```

Observed with the alias override:

```text
vite 8.0.16
rolldown 1.0.3
@rolldown/binding-wasm32-wasi 1.0.3
@napi-rs/wasm-runtime 1.1.6
@emnapi/core 1.10.0
@emnapi/runtime 1.10.0
rolldown-wasi-ok
07f18df34d7bb878a722ed65f632ec8ef410f5a2ef3379ffb10dcda774a40baf  package-lock.json
```

## Rifty

The same explicit alias and tuple run through the real browser installer,
Memory VFS, Node child, and forced-WASI import:

```sh
pnpm playwright test --config playwright.browser-unit.config.ts \
  tests/browser-unit/esbuild-vite-contract.spec.ts \
  --grep 'real Rifty install honors the npm-standard Vite 8 WASI runtime alias'
```

Observed:

```text
✓ real Rifty install honors the npm-standard Vite 8 WASI runtime alias
1 passed
```

The test asserts the same `1.0.3 / 1.1.6 / 1.10.0 / 1.10.0` tuple before
executing `NAPI_RS_FORCE_WASI=1 node rolldown-wasi-oracle.mjs`. The sibling
no-policy Chromium case installs runtime 1.2.0 and is RED before build/preview.

Conclusion: npm and Rifty agree on both graphs. The compatibility carrier is
the visible standard override; changing Rifty package or peer selection would
create resolver divergence.
