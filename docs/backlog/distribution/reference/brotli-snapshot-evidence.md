# Brotli snapshot delivery — 2026-10-23

Baseline: main `c392669742a27b1c8c47ca0edaf4c8c579e90edf`.
Input: user's `wrap-up-brotli-support-2026-10-23.md` (external research,
Rifty 0.10.0); its browser observation had no executable artifact. This probe
checks the current source independently.

## Reproduce

From repository root, dependencies installed:

```sh
mkdir -p /tmp/rifty-brotli-refine
node docs/backlog/distribution/reference/brotli-snapshot-probe.mjs
```

`brotli-snapshot-probe.mjs` bundles the real current loader for Chromium and
converts the committed Vite snapshot to TAR with the current serializer.
No fresh producer/install is run. Native Node gzip/Brotli encode that same TAR;
a loopback HTTP server supplies the representations to Chromium.
`brotli-snapshot-probe.json` records the output: Node v24.16.0,
Chromium 148.0.7778.96.

| Representation | Bytes | Loader result |
|---|---:|---|
| TAR | 27,831,808 | identity input |
| gzip, Node default level | 9,770,964 | matched; vite, 12 packages |
| Brotli quality 6 | 8,287,151 | matched; vite, 12 packages |
| Same Brotli without Content-Encoding | 8,287,151 | mismatch |

Brotli is 15.2% smaller than this gzip encoding. One fixture/quality setting,
not a universal saving or optimum. Identity for both HTTP-decoded responses:
`sha256:7d7363d5cd875f641694016ab9cc973c76d326bd0917652ecbbe4e78e0c6aea2`.
The probe reports encoding time for observation only, not a benchmark.
No full restore/program run, mobile performance, cache negotiation, corrupt
transfer, or 128 MiB boundary proof is claimed.

## Authorities and deductions

- ADR-0386: identity hashes uncompressed TAR; transport may differ.
- ADR-0387 and `packages/workbench/src/glue/dep-snapshot-producer.ts`:
  public producer returns gzip, with no format option; browser-compatible root API.
- `packages/workbench/src/glue/dep-snapshot.ts`: fetch, gzip magic sniff,
  decoded hash, parse. HTTP-decoded TAR needs no JS Brotli decoder.
- `packages/workbench/src/glue/bounded-asset-fetch.ts`: 128 MiB default bound;
  compressed Content-Length and browser-decoded body are checked separately.
- [MDN Content-Encoding](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Encoding),
  [Accept-Encoding](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Accept-Encoding),
  [Node zlib](https://nodejs.org/api/zlib.html), read 2026-10-23:
  HTTP representation coding and native offline Brotli are existing facilities.

Cheaper candidate for transfer-only value: decode current producer's gzip once
in the build, Brotli-encode the TAR, serve with correct HTTP Content-Encoding.
Host negotiation/cache correctness still needs an explicit delivery recipe and
proof; the probe's fixed endpoints do not implement Accept-Encoding negotiation.
User subsequently selected built-in production: «хотелось бы чтобы rifty из
коробки поддерживал Brotli тк он эффективнее в сжатии снэпшотов», after the
driver explained built-in production versus external recompression, and that
both routes still require HTTP server configuration. External recompression
alone therefore no longer meets the selected result.

The same probe also constructs CompressionStream with `gzip`, `br`, `brotli`.
Node v24.16.0 accepts `gzip` and `brotli`, rejects `br`; Chromium 148.0.7778.96
accepts only `gzip`. Constructor acceptance alone does not prove encoding
interoperability. HTTP Brotli support must not be confused with the browser
encoder surface. Codec selection and packaging remain PICKUP work; no decision
to restrict the existing browser-compatible producer to Node has been made.

## Dedup

Searched backlog titles/body/code references, goal maps, ADR declined concepts,
and process traps. No matching snapshot-Brotli item/decline.
Related, separate: `playground/snapshot-carries-substituted-bytes-twice` is
payload/cache deduplication; `runtime-js/zlib-web-compression-subset` is guest
Node zlib behavior. Neither owns HTTP delivery of dependency snapshots.
