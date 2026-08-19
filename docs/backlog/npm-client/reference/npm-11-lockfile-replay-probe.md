# npm 11 lockfile replay shape probe

Recorded 2026-08-19 on Node v24.16.0 / npm 11.17.0 against the committed
self-contained loopback registry probe (restored from `5619c7464` after the
faithful-npm-lock-replay epic close; extended with the peer RANGE replay
case). Run:

```sh
node docs/backlog/npm-client/reference/npm-11-lockfile-replay-probe.mjs \
  docs/backlog/npm-client/reference/npm-11-lockfile-replay-probe-output.json
```

The normalized output records lockfile v3, an entry-level
`optionalDependencies` map with both `wasm32` and `x64` CPU siblings, and a
peer-only `peer-target` entry reachable from `peer-source.peerDependencies`.
This pins the carrier shape; Rifty's CPU policy admits the WASI sibling and
loudly skips the native sibling.

`rangePeer` pins the peer RANGE replay contract: npm records
`range-peer-source.peerDependencies = { range-peer-target: "^1.0.0" }`
VERBATIM on the entry, pins `range-peer-target@1.2.0`, and `npm ci` from that
lock reifies 1.2.0 with exit 0 — replay materializes the ranged peer edge onto
the exact pinned entry without re-resolving or re-litigating the range. Rifty's
lockfile replay must therefore never re-run request-shape (shadow-recipe)
admission with a recorded peer range when the recorded pin IS the attested
product.
