# Brotli production evidence

Baseline: `b68e5c782cc04ef6ad8716efd077050678c6d3c7`.
Node v24.16.0, Chromium 148.0.7778.96; producer contract ADR-0546.

## Codec selection

`brotli-compress@2.2.2` inline ESM, Rust Brotli WASM, quality 6. Package
API/source inspected from the installed tarball and upstream
https://github.com/kyr0/brotli-compress . No caller assets/codecs; lazy import.
`brotli-wasm@3.0.1` instead needs host-sensitive entry/asset handling; a native
Node encoder would lose browser production. No decode library added to reader.
Independent DEC-2 critic: clear; preserves selected scope and browser support.

Reproduce representative size/cost: `node docs/backlog/distribution/reference/brotli-codec-probe.mjs`.
Committed Vite snapshot serialized as TAR: 27,831,808 B; Node gzip default
9,770,964 B; WASM quality 6 9,253,244 B (~5.3% smaller), 860 ms on this host.
Inline module 1,360,947 B. Native quality 6 in the earlier reader probe gave
8,287,151 B: different encoders do not promise identical output or ratio.
Native `brotliDecompressSync` recovered the exact TAR. Cost is production CPU
and an on-demand module, not an added project-open decoder. No mobile claim.

## Carriers

- `pnpm exec vitest run packages/workbench/src/glue/dep-snapshot-producer.test.ts tests/integration/brotli-snapshot-delivery.test.ts`: actual public producers, original registry tarball, Node oracle, Chromium HTTP decoding/faults. No mocked Rifty sibling or codec.
- `pnpm test:packed-consumer`: installed package public producer, caller-generated Vite lock, gzip/Brotli native equality; negotiated HTTP Brotli snapshot opens/builds/runs Vite and exercises existing HMR/saved state.
- Existing bounded reader and producer pin/replay suites retain baseline authority.

Contract RED precedes product code; new metadata/invalid-encoding assertions
and Chromium producer fail against the gzip-only baseline. Final executions
and exact review binding recorded on the PR.
