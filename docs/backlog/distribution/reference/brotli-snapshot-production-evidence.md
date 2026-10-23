# Brotli production evidence

Baseline: `b68e5c782cc04ef6ad8716efd077050678c6d3c7`.
Node v24.16.0, Chromium 148.0.7778.96; producer contract ADR-0546.

## Codec selection

`brotli-compress@2.2.2` inline ESM, Rust Brotli WASM, quality 11. Package
API/source inspected from the installed tarball and upstream
https://github.com/kyr0/brotli-compress . No caller assets/codecs; lazy import.
`brotli-wasm@3.0.1` instead needs host-sensitive entry/asset handling; a native
Node encoder would lose browser production. No decode library added to reader.
Independent DEC-2 critic: clear; preserves selected scope and browser support.

Reproduce representative size/cost: `node docs/backlog/distribution/reference/brotli-codec-probe.mjs`.
Committed Vite snapshot serialized as TAR: 27,831,808 B; Node gzip default
9,770,964 B; WASM quality 11 7,635,659 B (~21.9% smaller), ~39 s on this host.
Inline module 1,360,947 B. The earlier quality 6 choice produced 9,253,244 B
(~5.3% smaller), ~860 ms. The weak reduction was a quality choice, not an
inherent WASM encoder ceiling; the quality sweep below replaces that explanation.
Native `brotliDecompressSync` recovered the exact TAR. Cost is production CPU
and an on-demand module, not an added project-open decoder. No mobile claim.

## Quality follow-up (2026-10-23)

Same committed Vite TAR, Node v24.16.0, local Mac; historical follow-up
measurements supplied with the handoff. Native encoder uses
`brotliCompressSync` with `constants.BROTLI_PARAM_QUALITY`; WASM uses
`compress(tar, { quality })`. Sizes are bytes; timings are host-specific.

| Quality | Native bytes | Native encode | WASM bytes | WASM encode |
|---|---:|---:|---:|---:|
| 6 | 8,287,151 | 0.3 s | 9,253,244 | 0.75 s |
| 9 | 8,159,942 | 1.1 s | 8,149,781 | 1.9 s |
| 10 | 7,745,142 | 13 s | 7,759,761 | 25 s |
| 11 | 7,629,469 | 33 s | 7,635,659 | 39 s |

Native decode, mean of five runs (`gunzipSync` / `brotliDecompressSync`):

| Representation | Decode |
|---|---:|
| gzip, default | 33 ms |
| Brotli q6 | 36 ms |
| Brotli q9 | 38 ms |
| Brotli q11 | 59 ms |

Select q11: one-time production cost buys ~22% fewer download bytes than gzip
and ~17.5% fewer than WASM q6. Decode is not identical across qualities in
this sample, but remains tens of milliseconds. Workbench relies on browser
HTTP Content-Encoding decoding; these native numbers are not browser timings.

Encoding costs roughly 1.5 s/MB of TAR in Node. Linear extrapolation to the
128 MiB decoded bound is ~3 minutes, not a measured bound. Synchronous WASM
inside the async producer blocks the browser UI; use a Worker. The public
producer has byte bounds, no production timeout. The packed Vite subprocess
budget is 300 s (was 120 s), within the unchanged 1,420 s runner / 1,500 s
Vitest budgets. Browser-unit retains 120 s: its produced `ms` fixture is tiny;
the 128 MiB reader fault fixture uses native q0, not this producer. CI packed
and browser-unit jobs impose no additional explicit job/step timeout.

Follow-up rerun at baseline `8874e47d65cda8c41e06c84173084e8fbf176e60`:
q6 probe 9,253,244 B / 740 ms; after q11 change 7,635,659 B / 37,843 ms,
Node v24.16.0. Both recovered the exact TAR through native Brotli decoding;
public producer tests passed 13/13 before and after. This changes an internal
quality choice under the landed ADR-0546 behavior, with no new API/state promise.

## Carriers

- `pnpm exec vitest run packages/workbench/src/glue/dep-snapshot-producer.test.ts` and `pnpm test:browser-unit brotli-snapshot-delivery.spec.ts`: actual public producers, original registry tarball, Node oracle, Chromium HTTP decoding/faults. No mocked Rifty sibling or codec.
- `pnpm test:packed-consumer`: installed package public producer, caller-generated Vite lock, gzip/Brotli native equality; negotiated HTTP Brotli snapshot opens/builds/runs Vite and exercises existing HMR/saved state.
- Existing bounded reader and producer pin/replay suites retain baseline authority.

Contract RED precedes product code; new metadata/invalid-encoding assertions
and Chromium producer fail against the gzip-only baseline. Final executions
and exact review binding recorded on the PR.

Original q6 packed producer (Vite 7.3.6, caller npm v3 lock): gzip 9,770,979 B,
Brotli 9,253,675 B. Native decoded TAR equality and both identities checked
by `produce-vite-snapshot.mjs` before browser launch. This is fresh production,
not the earlier committed-snapshot conversion.

2026-10-23 local GREEN: public producer tests 13/13, Chromium delivery/fault
carrier 1/1 (before lane relocation); complete `pnpm test:packed-consumer`
1/1, 376.94 s, including public package install, Vite build/dev/HMR, saved
state and benchmark reference-host smoke. Full test log retained during run
at `/tmp/rifty-brotli-packed.log`; reproducible through the commands above.

After carrier relocation: `RIFTY_PLAYGROUND_PORT=5397 pnpm test:browser-unit
brotli-snapshot-delivery.spec.ts` passed (1 test, 11.0 s). `pnpm pr:check`
passed all 28 stages, including related tests (35.9 s, no isolated rerun)
and full parity (165.7 s). No gate skipped; the later dependency-criterion correction is recorded below.

## CI boundary correction

Full CI at 57c705ccf: 11,249 tests passed, one extraction-boundary failure.
`pnpm exec vitest run packages/workbench/tests/extraction-boundary.contract.test.ts`
reproduced 1 failed / 4 passed: the exact external-package list omitted the
ADR-0546-approved `brotli-compress`. Fault class: frozen-assumption at the
owned package-boundary criterion. Sweep found one owning list, used for both
import closure and manifest dependencies. Add only this approved dependency;
retain exact list equality, sealed exports, package closure and forbidden-import
assertions. This is the explicit PR-4 criterion correction, not a runtime fix.

Boundary correction GREEN: isolated extraction suite 5/5; repeated
`pnpm pr:check` all 28 PASS (related tests 29.4 s, full parity 158.5 s).
The source-scanning extraction test is outside Vitest's static import graph;
full CI exposed the missing criterion update. Product code remains unchanged.
