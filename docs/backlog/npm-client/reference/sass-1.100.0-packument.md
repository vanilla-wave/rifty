# Sass 1.100.0 registry, tarball, and required closure

Captured 2026-08-02 from the public npm registry with Node v24.16.0,
npm 11.17.0, bsdtar 3.5.3 / libarchive 3.7.4, and OpenSSL 3.6.2. The exact
archives are committed under `tools/shadow-registry/src/fixtures/`; JSON
identities are in `sass-1.100.0-registry.json`,
`sass-1.100.0-tarball.json`, and `sass-1.100.0-closure.json`.

## Parent projection

Capture the official manifest and archive:

```sh
node --input-type=module -e "
  const metadata = await (await fetch('https://registry.npmjs.org/sass/1.100.0')).json();
  const bytes = new Uint8Array(await (await fetch(metadata.dist.tarball)).arrayBuffer());
  await (await import('node:fs/promises')).writeFile('/tmp/sass-1.100.0.tgz', bytes);
  console.log(JSON.stringify(metadata));
" | jq '{name, version, dist: {integrity: .dist.integrity}, dependencies: (.dependencies // {}), optionalDependencies: (.optionalDependencies // {}), peerDependencies: (.peerDependencies // {}), bundleDependencies: (.bundleDependencies // .bundledDependencies // []), bin: (.bin // {})}'
```

```json
{
  "name": "sass",
  "version": "1.100.0",
  "dist": {
    "integrity": "sha512-B5j0rYMlinhhOo9tjQebMVVn0TfyXAF+wB3b2ggZUuJ/is/Y+7+JGjirAMxHZ9Z3hIP98NPfamlAkBHa1lAaXQ=="
  },
  "dependencies": {
    "chokidar": "^5.0.0",
    "immutable": "^5.1.5",
    "source-map-js": ">=0.6.2 <2.0.0"
  },
  "optionalDependencies": {
    "@parcel/watcher": "^2.4.1"
  },
  "peerDependencies": {},
  "bundleDependencies": [],
  "bin": {
    "sass": "sass.js"
  }
}
```

Archive identity:

```sh
wc -c < /tmp/sass-1.100.0.tgz
openssl dgst -sha256 /tmp/sass-1.100.0.tgz
printf 'sha512-'
openssl dgst -sha512 -binary /tmp/sass-1.100.0.tgz | openssl base64 -A
```

```text
bytes 927111
sha256 21c392fda32899b07c59a5e132f2503b72429ae47600bf205420e981214a4af9
sha512-B5j0rYMlinhhOo9tjQebMVVn0TfyXAF+wB3b2ggZUuJ/is/Y+7+JGjirAMxHZ9Z3hIP98NPfamlAkBHa1lAaXQ==
```

Critical member identities:

| member | bytes | SHA-256 |
|---|---:|---|
| `package/package.json` | 856 | `93e944aabda9ad95cd809f22c5dc240afd29f6ee789f73de7f9f6a03642d4f2c` |
| `package/sass.dart.js` | 5,658,363 | `f558f0ddc8031343d8351e61ca0b364fb6143679b17b85cbd9be04b5ed74965f` |
| `package/sass.node.js` | 343 | `eb7a01ba57a04a0a421bdef0bf2f43558af4790b540a45501ec83900b07b0625` |
| `package/sass.node.mjs` | 5,502 | `45c68fef99d4c4ce5bffc14a48297a386b115ac056264e739dce3fdc0ad13f53` |

The recipe retains all three required dependencies, omits
`@parcel/watcher`, has empty peer/bundle maps, suppresses the acquired `sass`
bin, and materializes a bin-free `sass-embedded` facade.

## Required closure

Resolve with the same npm/Node versions and scripts disabled:

```sh
oracle_root=$(mktemp -d)
npm install --prefix "$oracle_root" --ignore-scripts --omit=optional \
  --registry=https://registry.npmjs.org sass@1.100.0
npm ls --prefix "$oracle_root" --all --json
```

Exact physical closure:

```text
sass@1.100.0
├── chokidar@5.0.0
│   └── readdirp@5.0.0
├── immutable@5.1.9
└── source-map-js@1.2.1
```

| package | range from parent | version | bytes | SHA-256 | integrity |
|---|---|---:|---:|---|---|
| `chokidar` | `^5.0.0` | 5.0.0 | 23,399 | `45d07ea7d57ee482c733ab3c547cc49edc1423bc231507e41ff99d2711f7f5e3` | `sha512-TQMmc3w+5AxjpL8iIiwebF73dRDF4fBIieAqGn9RGCWaEVwQ6Fb2cGe31Yns0RRIzii5goJ1Y7xbMwo1TxMplw==` |
| `readdirp` | `^5.0.0` | 5.0.0 | 7,530 | `01ecd9d6bf8fdb4b8c462b23d1d8f69604841050ac4316e6fe67967a62b00407` | `sha512-9u/XQ1pvrQtYyMpZe7DXKv2p5CNvyVwzUB6uhLAnQwHMSgKMBR62lc7AHljaeteeHXn11XTAaLLUVZYVZyuRBQ==` |
| `immutable` | `^5.1.5` | 5.1.9 | 148,909 | `9481d33c209e07f82933a0f8132348ee9325d72ce196ebc47a93b9b2703f3068` | `sha512-m8nVez3rwrgmWxtLMt1ZYXB2Lv7OKYn/disyxAlSDYAlKSlFoPPfIAmAM/M5xqL4m4C/wAPw7S2/CNaUii1Hxg==` |
| `source-map-js` | `>=0.6.2 <2.0.0` | 1.2.1 | 35,340 | `f126a6f9fca487a43219d8cb8c3a955279187a966119d548eb5cd47e999d4853` | `sha512-UXWMKhLOwVKb728IUtQPXxfYU+usdybtUrK/8uGE8CQMvrhOpwvzDBwj0QhSL7MQc7vIsISBG8VQ8+IDQxpfQA==` |

`@parcel/watcher` is absent from the physical tree and produces no registry or
tarball request in the substitution path. npm itself retains optional metadata
in `package-lock.json` under `--omit=optional`, so the upstream omission proof
is the request ledger plus physical absence, not a lockfile-absence assertion.
rifty separately binds the reviewed omitted map through the recipe digest and
publishes no materialized child entry for it.
