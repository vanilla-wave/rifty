# PR #321 concern carriers — 2026-09-08

Baseline: `0e065420c`; tests extend existing stream/dedup behavior. No product
change required. Real Chromium `148.0.7778.96`, Node `v24.16.0`, real OPFS.
Only native method forwarding, holding and rejection injected; no product mocks.

## Concern 2 — stream visibility

Command:
`RIFTY_NO_COI_PORT=5581 RIFTY_NO_COI_ORACLE_PORT=5582 RIFTY_NO_COI_RESOURCE_PORT=5583 pnpm test:no-coi no-coi-stream-visibility.spec.ts`

Output: `1 passed (4.6s)`; carrier `553ms`; no retries.
Public SDK boots actual no-COI toolchain Worker from persisted OPFS baseline.
Native `createWritable` held after `fs.writeFileSync`; `fs.createReadStream`
completes while native file still contains `old durable bytes` before/after reads.
Release forwards the native write; persisted bytes become the exact sync payload.

Identical consumer executed in a separate real Node process during the test:

| Observation | Node and Worker |
|---|---|
| Full, highWaterMark 2 | `[0,255,17,128,65,0,234,42,99]` |
| Inclusive window start 2/end 6 | `[17,128,65,0,234]` |
| Missing file | `ENOENT`, zero data |
| Path through file | `ENOTDIR`, zero data |
| Directory | `EISDIR`, zero data |

## Concern 7 — unreadable durable equality proof

Command:
`RIFTY_PLAYGROUND_PORT=5375 pnpm test:browser-unit install-mirror-proof.spec.ts`

Output: `1 passed (4.1s)`; carrier `143ms`; no retries.
Both native `getFile` and `Blob.arrayBuffer` rejection target an otherwise clean,
nonempty file with equal native/mirror/incoming bytes. Each boundary reports:

- Read rejection → ordinary write attempted once; flush `0`; native exact bytes.
- Read rejection + native quota → write attempted once; flush `1`, path/op `write`;
  repeated flush still `1`; persistence remains unclean.
- Native recovery + same write → write attempted once; flush `0`; persistence
  clean; native bytes remain `nonempty durable bytes`.

Existing empty/alias/dirty/pending/directory cases also pass. Read failure never
becomes an empty successful read or a deduplicated success hiding a failed write.

Formatting: `pnpm exec biome check tests/no-coi/no-coi-stream-visibility.spec.ts tests/browser-unit/install-mirror-proof.spec.ts tests/browser-unit/fixtures/install-mirror-proof-worker.ts`
→ `Checked 3 files ... No fixes applied.`
