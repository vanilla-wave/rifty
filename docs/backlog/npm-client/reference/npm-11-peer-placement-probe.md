# npm 11 peer placement and traversal probe

Recorded 2026-07-28 on Node v24.16.0 / npm 11.17.0 against a
self-contained loopback registry. Probe source SHA-256:
`ec0cc9354ef4d7c01a75125b1a4e3bea0ad9f0b3d99598ad1d4fb8bb0b0da28a`.
Canonical output SHA-256:
`edefe928491431545846ad63c3517863da1305d8acb7d3479df9c9d4ecb538c1`.

```text
contract-host@1.0.0
└── contract-source@1.0.0
    └── peer contract-peer@^2.0.0

contract-peer@1.0.0
contract-peer@2.0.0
└── contract-leaf@1.0.0
```

Run:

```sh
node docs/backlog/npm-client/reference/npm-11-peer-placement-probe.mjs \
  /tmp/rifty-peer-placement-probe-output.json
shasum -a 256 /tmp/rifty-peer-placement-probe-output.json
```

The committed
`npm-11-peer-placement-probe-output.json` is the complete normalized result:
exit/signal/stdout/stderr, registry request multiset, both lockfiles, and every
materialized package manifest. Normalization replaces only the loopback origin,
temporary root, duration, and npm log timestamp; request order is sorted because
tarball fetch completion order is not placement authority.

Cases:

- direct source with no peer installs peer 2 and its leaf at root;
- nested source with no peer hoists source, peer 2, and leaf to root;
- direct source plus root peer 1 fails `ERESOLVE` before `node_modules` or a
  lockfile exists;
- nested source plus root peer 1 places source and peer 2 below the host while
  peer 1 and the peer's ordinary leaf remain at root.

For every successful case the probe removes `node_modules` and runs npm
`--offline`. The complete tree and both lockfiles reproduce byte-for-byte with
zero registry requests. Peer placement is therefore a traversal and replay
contract, not a post-install presence check.
