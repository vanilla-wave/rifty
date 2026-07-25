# ADR 0322: Split process identity into Node compatibility and rifty host axes

Status: Accepted
Date: 2026-07

> TL;DR: Node API-family selectors report the Node 24 target; OS/native
> provenance remains explicitly rifty/wasm.

## Context

ADR-0026 made `process.platform === 'rifty'` and `process.arch === 'wasm'`
public commitments so native packages fail recognizably instead of acting on a
fake OS. Separately, ADR-0164 made Node 24 the compatibility target and the
runtime already exposes `version === 'v24.0.0'` and
`versions.node === '24.0.0'`.

That distinction was unrecorded. Dart Sass 1.100.0 makes it observable:
`sass.node.js` selects its filesystem-capable implementation through
`process.release.name === 'node'`. Missing that selector misclassifies the Node
API runtime as a browser and produces a false filesystem gap.

`process.release` also carries official Node distribution URLs and LTS
metadata. Rifty is not built from those archives and does not support native
Node addons, so copying those values would claim false provenance.

## Decision

Process identity has two explicit axes:

- Compatibility identity: `version === 'v24.0.0'`,
  `versions.node === '24.0.0'`, and `release.name === 'node'`. These select the
  Node 24 JavaScript API family rifty implements and parity-tests.
- Host identity: `platform === 'rifty'`, `arch === 'wasm'`, and
  `versions.rifty`. These identify the actual browser/WASM host.

`release.name` matches Node 24's data descriptor. Every process owns a fresh,
ordinary, extensible release object; the outer property and `name` are
non-writable, enumerable, and configurable.

Rifty uses Node's permitted custom-build minimal shape: no `sourceUrl`,
`headersUrl`, `libUrl`, or `lts`. No Sass-specific process override is allowed.
ADR-0026 remains active and unchanged.

## Consequences

- Packages may select proven Node JavaScript paths without mistaking rifty for
  a native Node host.
- Official Node distribution and LTS provenance stays absent rather than
  fabricated.
- Packages requiring a real OS or native addon still see `rifty` / `wasm` and
  fail loudly at the honest boundary.
- New process identity fields must be classified as compatibility or host
  identity and parity-proven against Node 24.
