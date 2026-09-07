# VM preboot evidence

Baseline: accepted I1 @ d3114140a; Node v24.16.0, Chromium 148.0.7778.96.

- `vm-preboot-baseline.json`: packed SDK default/quickjs/rewrite all used QuickJS,
  lacked a vm capability row, and fetched WASM twice across boot/restart.
- `node docs/backlog/distribution/reference/vm-worker-name-probe.mjs`:
  native HTTP/Blob × omitted/custom/two reserved names passes 8/8. Name is
  available before and after dynamic import; query/fragment and request URL
  unchanged. Earlier query probe failed for Blob; fragment worked but required
  URL editing. Native name is the minimal selected carrier (ADR-0383).
- `tests/integration/no-coi-vm-browser-proof.mjs` compares actual SDK VM behavior
  with a native Node subprocess and the explicitly accepted rewrite divergences.
  On baseline: 7 expected RED cases — HTTP/Blob default/rewrite still request
  WASM; HTTP/Blob quickjs lacks the reserved construction name; generic rewrite
  still preloads WASM. Generic default/quickjs and selected-WASM failure are
  already GREEN and remain baseline obligations.
- Fault injection aborts the real configured WASM request; no fake runtime,
  Worker, VM implementation or tarball. Blob wrapper publishes the existing
  absolute QuickJS artifact URL before dynamic import, per ADR-0352.

Reproduce from fresh real tarballs:
`node tests/integration/workbench-packed-consumer.mjs --surface-only --keep`.
The surface harness builds all graphs, runs compiler proof, then VM proof.
A focused rerun reads that consumer's `measure/report.json` and calls
`provePackedVmSelection(consumerRoot, report)`. No product I2 implementation
exists at the RED checkpoint.
