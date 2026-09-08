# Rollup companion frontier — original npm fixtures

2026-09-08, Node24.16.0/npm11.17.0. Each input directory contains the original
manifest and npm-authored v3 lock. Generated in an empty temporary directory:

`npm install --package-lock-only --ignore-scripts --no-audit --no-fund --registry https://registry.npmjs.org --cache <temporary-cache>`

- `root`: ordinary Rollup4.63.1; npm never adds rifty's WASM companion.
- `retained`: caller also pins @rollup/wasm-node4.63.1. Both packages claim
  ordinary `rollup` bins; existing rifty policy refuses this co-demand.
- `conflict`: caller pins @rollup/wasm-node4.62.2; same bin-co-demand exclusion.
  Its original older companion identity supplies a retained-pin fault input.
- `nested`: Vite7.3.6 + root Rollup4.42.0 + esbuild0.28.0. Vite's ^4.43 request
  pins nested Rollup4.63.1. Both trigger versions are in existing ^4 support.

`packages/*.json`: original exact-version registry responses from
`https://registry.npmjs.org/<encoded-name>/<version>`. `*.tgz`: original response
from each `dist.tarball`; never repacked or patched. `provenance.json` records
URLs, exact versions, SHA512 SRI and byte sizes; fixture loader verifies them.
Metadata JSON is formatted; original metadata fields and tarball bytes remain.
17tarballs, 8,323,806bytes. Native optional tarballs are omitted: actual npm locks
retain their pins; retained traversal skips them before HTTP. Fresh-install
controls model their missing fixture metadata as unavailable optional HTTP.

Extra tarballs are declared Rollup companions and esbuild-wasm0.28.0. All
ordinary dependency archives come from these real locks. Fault tests explicitly
mutate copies of input locks or HTTP responses; committed inputs stay unchanged.
Positive retained-companion controls use the real lock returned by a fresh
existing rifty install of `root`, then replay it in a fresh Memory VFS. This
retains companion provenance without inventing ordinary root dependencies or
removing upstream bins. The nested producer case refuses new ordinary child
paths; it promises no new placement or general nested snapshot compatibility.

Independent real Node oracle: the same Vite7.3.6/Rollup4.63.1/esbuild0.28.0 pins
passed `npm ci --ignore-scripts` then real `vite build` (3modules, exit0).
Producer contract also executes the extracted adapted Rollup through real Node;
WASM parser must produce an executable bundle returning42.
