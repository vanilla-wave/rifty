# Sass / Vite 7.3.6 real-Node build oracle

Recorded 2026-08-02 on Node v24.16.0, npm 11.17.0, Darwin arm64, with exact
`vite@7.3.6` and `sass-embedded@1.100.0`. Two independent fresh trees used
separate npm caches and homes, disabled lifecycle scripts, applied the same
palette edit, and produced byte-identical lockfiles and `dist/` trees. A third
lock-pinned `npm ci --offline` replay produced the same build.

The normalized executable artifact is
`tools/shadow-registry/src/fixtures/sass-vite-7.3.6-node-build.json`, SHA-256
`3e1cf5ceb64171e86633c3dc4c5d97379cf2aa41bb1540b1d3f228a80a1cc1d8`.
It pins every input SHA, exact `vite --version`, warning bytes, output
names/bytes/SHA, lock identity counts and projection digests, and offline
replay outcome.

The exact npm v3 lock is
`tools/shadow-registry/src/fixtures/sass-vite-7.3.6-package-lock.fixture`: 60,340
bytes, SHA-256
`50be275d9e16dcab67a80947e81a21c4ca7260db9dd1c6bdfca7d2cda862079f`.

The exact project tree and palette edit are executable data in
`tools/shadow-registry/src/fixtures/sass-vite-7.3.6-project.ts`. Both the real
Chromium acceptance and the Node generator import that one fixture; neither
keeps an independent Vite/Sass project string.

## Reproduce

```sh
node --version
npm --version
pnpm --filter @riftydev/shadow-registry sass-vite-oracle:check
```

The check writes the committed lock into two isolated trees, each with a fresh
npm home, cache, and temporary root, then runs online
`npm ci --ignore-scripts`. Both exact lock/build results must match. A third
isolated tree receives the same lock and the first cache, runs
`npm ci --ignore-scripts --offline`, and must reproduce the result before the
committed JSON is compared.

Intentional refresh uses `sass-vite-oracle:generate`. It instead runs two
isolated `npm install --ignore-scripts` resolutions, proves exact equality,
then proves an offline lock replay. Only after all three agree does it replace
the exact lock and normalized oracle. Both modes require network for their two
online trees; no registry URL is embedded in the generator.

Schema 2 records a canonical path-to-SHA map for every shared project input,
plus the palette edit's exact path, source bytes/SHA, and target bytes/SHA.

## Observable result

The edited project emits exact CSS
`.card{color:#095741;padding:11px}.card .label{font-weight:700}\n`, one
`rifty-sass-warning`, one hashed CSS file, one hashed JavaScript file and its
map, and `index.html`. Vite emits no external CSS map for this configuration,
including with `build.sourcemap: true`; requiring a fabricated `.css.map`
would diverge from the real Node oracle.
