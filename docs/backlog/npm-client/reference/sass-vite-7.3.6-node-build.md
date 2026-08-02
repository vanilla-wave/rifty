# Sass / Vite 7.3.6 real-Node build oracle

Recorded 2026-08-02 on Node v24.16.0, npm 11.17.0, Darwin arm64, with exact
`vite@7.3.6` and `sass-embedded@1.100.0`. Two independent fresh trees used
separate npm caches and homes, disabled lifecycle scripts, applied the same
palette edit, and produced byte-identical lockfiles and `dist/` trees. A third
lock-pinned `npm ci --offline` replay produced the same build.

The normalized executable artifact is
`tools/shadow-registry/src/fixtures/sass-vite-7.3.6-node-build.json`, SHA-256
`ab2a4648ba724845a688b384d68d07113e72a37a5f524c0a254a40e10b901d48`.
It pins every input SHA, exact `vite --version`, warning bytes, output
names/bytes/SHA, lock identity counts and projection digests, and offline
replay outcome.

## Reproduce

```sh
node --version
npm --version
npm install --ignore-scripts --audit=false --fund=false
npx vite --version
npx vite build
npm ci --ignore-scripts --offline --audit=false --fund=false
npx vite build
```

Use a clean tree and the input bytes identified by the artifact. Set `CI=1`,
`NO_COLOR=1`, `TZ=UTC`, `LANG=C`, and `LC_ALL=C`; isolate npm home/cache between
the two fresh runs.

## Observable result

The edited project emits exact CSS
`.card{color:#095741;padding:11px}.card .label{font-weight:700}\n`, one
`rifty-sass-warning`, one hashed CSS file, one hashed JavaScript file and its
map, and `index.html`. Vite emits no external CSS map for this configuration,
including with `build.sourcemap: true`; requiring a fabricated `.css.map`
would diverge from the real Node oracle.
