# lightningcss-wasm 1.32.0 registry and tarball projection

Registry metadata captured 2026-07-26 from the configured primary npm
registry. Exact tarball evidence recaptured 2026-08-02 with Node v24.16.0,
bsdtar 3.5.3 / libarchive 3.7.4, OpenSSL 3.6.2, and jq 1.7.1:

```sh
node --version
bsdtar --version
openssl version
jq --version

node --input-type=module -e "
  const metadata = await (await fetch('https://registry.npmjs.org/lightningcss-wasm/1.32.0')).json();
  const bytes = new Uint8Array(await (await fetch(metadata.dist.tarball)).arrayBuffer());
  await (await import('node:fs/promises')).writeFile('/tmp/lightningcss-wasm-1.32.0.tgz', bytes);
  console.log(JSON.stringify(metadata));
" | jq '{name, version, dist: {integrity: .dist.integrity}, dependencies: (.dependencies // {}), optionalDependencies: (.optionalDependencies // {}), peerDependencies: (.peerDependencies // {}), bundleDependencies: (.bundleDependencies // .bundledDependencies // [])}'
```

```json
{
  "name": "lightningcss-wasm",
  "version": "1.32.0",
  "dist": {
    "integrity": "sha512-SteAkCtRuSCDYPGHKhLV/dDs5Bk+7I4QUxWxfk4xwsTI1rQk8MQyYtpGcd3NECsUGzK0q2/KqoVS+YHCqKHUTQ=="
  },
  "dependencies": {
    "napi-wasm": "^1.0.1"
  },
  "optionalDependencies": {},
  "peerDependencies": {},
  "bundleDependencies": [
    "napi-wasm"
  ]
}
```

The downloaded archive is pinned by
`tools/shadow-registry/src/fixtures/lightningcss-wasm-1.32.0-tarball.json`.
Reproduce its archive identity:

```sh
wc -c < /tmp/lightningcss-wasm-1.32.0.tgz
openssl dgst -sha256 /tmp/lightningcss-wasm-1.32.0.tgz
printf 'sha512-'
openssl dgst -sha512 -binary /tmp/lightningcss-wasm-1.32.0.tgz | openssl base64 -A
```

Expected archive facts:

```text
bytes 3821302
sha256 ea1419e577dd943907c7e17a99fa7a76143d99c6279a6131e79fb4b1b098ac89
sha512-SteAkCtRuSCDYPGHKhLV/dDs5Bk+7I4QUxWxfk4xwsTI1rQk8MQyYtpGcd3NECsUGzK0q2/KqoVS+YHCqKHUTQ==
```

Reproduce the complete embedded package inventory and each member identity:

```sh
bsdtar -tf /tmp/lightningcss-wasm-1.32.0.tgz |
  grep '^package/node_modules/napi-wasm/' |
  sort

for member in \
  package/package.json \
  package/node_modules/napi-wasm/README.md \
  package/node_modules/napi-wasm/index.js \
  package/node_modules/napi-wasm/index.mjs \
  package/node_modules/napi-wasm/package.json
do
  printf '%s ' "$member"
  bsdtar -xOf /tmp/lightningcss-wasm-1.32.0.tgz "$member" | wc -c
  bsdtar -xOf /tmp/lightningcss-wasm-1.32.0.tgz "$member" | openssl dgst -sha256
done

bsdtar -xOf /tmp/lightningcss-wasm-1.32.0.tgz \
  package/node_modules/napi-wasm/package.json |
  jq '{name, version}'
```

The top-level `package/package.json` is 1,186 bytes with SHA-256
`b7f16ae6a0036f2d92a22efdfff34482ec6b9ef33c519b8c0e858dbf2d403410`.
The embedded package is exactly `napi-wasm@1.1.3` and has four members:

| member | bytes | SHA-256 |
|---|---:|---|
| `README.md` | 4,246 | `e646406048bd592d66f5a4deeadb41ab5071ee051a530a7346f7ed2eb520e8e1` |
| `index.js` | 42,418 | `ad46aa59b86c852819ba521cdbde18348467e448ce4e466e83e53ea60896bc8d` |
| `index.mjs` | 42,375 | `0108dc67b01e6f4e8493720a51f58747f5318ff13294bb4636fce108515e0101` |
| `package.json` | 810 | `979a10d090dc49549d31ee206b60863950712145a3bebf9fe21a0919e8ca77a1` |

The recipe projection must therefore preserve the required
`napi-wasm@^1.0.1` range, bundled membership, and exact embedded
`napi-wasm@1.1.3` artifact. Empty fake-registry metadata or a separately
resolved `napi-wasm` tarball is not evidence for this package.
