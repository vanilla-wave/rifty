# npm 11 lockfile replay shape probe

Recorded 2026-08-17 on Node v24.16.0 / npm 11.17.0 against the committed
self-contained loopback registry probe. Run:

```sh
node docs/backlog/npm-client/reference/npm-11-lockfile-replay-probe.mjs \
  docs/backlog/npm-client/reference/npm-11-lockfile-replay-probe-output.json
```

The normalized output records lockfile v3, an entry-level
`optionalDependencies` map with both `wasm32` and `x64` CPU siblings, and a
peer-only `peer-target` entry reachable from `peer-source.peerDependencies`.
This pins the carrier shape; Rifty's CPU policy admits the WASI sibling and
loudly skips the native sibling.
