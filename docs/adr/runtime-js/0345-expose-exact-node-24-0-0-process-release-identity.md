# ADR 0345: Expose exact Node 24.0.0 process.release identity

Status: Accepted
Date: 2026-08

> TL;DR: every rifty Node process exposes the exact non-LTS Node v24.0.0
> `process.release` object, including descriptors and per-process isolation.

## Context

ADR-0164 fixes Node 24 as rifty's parity target and the runtime already exposes
`process.version === 'v24.0.0'` plus `process.versions.node === '24.0.0'`.
Official Node v24.0.0 reports:

```js
{
  name: 'node',
  sourceUrl: 'https://nodejs.org/download/release/v24.0.0/node-v24.0.0.tar.gz',
  headersUrl: 'https://nodejs.org/download/release/v24.0.0/node-v24.0.0-headers.tar.gz'
}
```

The outer property and all three fields are non-writable, enumerable, and
configurable. The release object remains extensible and is not frozen. v24.0.0
was not an LTS release, so it has no `lts`; non-Windows builds have no `libUrl`.

Exact `sass@1.100.0` uses two Node selectors. Its bootstrap checks
`process.versions.node`, then its path API checks
`process.release.name === 'node'`. Rifty had the first field but not the
second, so real Chromium reached the exact facade yet `compile()` rejected with
`The compile() method is only available in Node.js.`. Faking this inside the
Sass facade would leave every other Node consumer with the same runtime gap.

## Decision

- Add the exact Node v24.0.0 release values to the shared process identity.
- Every `NodeProcess` owns a fresh release object. Match Node's outer and inner
  descriptors; preserve extensibility and configurable deletion without
  leaking mutation across processes.
- `name: 'node'` is the same compatibility identity already carried by
  `version`/`versions.node`, not an OS claim. ADR-0026's honest
  `platform: 'rifty'` and `arch: 'wasm'` remain unchanged.
- Keep the release version coupled to the single identity constant. A future
  parity-target change updates version, URLs, tests, and public changelog
  together.

## Consequences

- Node packages can use the standard release identity instead of a
  package-specific selector shim.
- Node v24.0.0 values and descriptors become public compatibility commitments.
- The separate `process.versions.node` honesty question remains in
  `runtime-js/process-versions-node-honesty`; this decision does not change its
  value or ADR-0026's platform/architecture boundary.
