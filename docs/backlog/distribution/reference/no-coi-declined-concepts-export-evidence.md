# No-COI declined-concepts export — evidence (2026-09-04)

## RED

Fresh read-only CLOSE audit @ `6e8f549d6`:

- ledger 9/87 accepted demand/M11 risk had no durable disposition;
- map 20 lost `spawnSync`; map 32 lost no-own-origin → no-SW → no-preview;
- Declined concepts omitted rejected routes from ADR-0372/0374/0376/0377/
  0379 and the duplicate `onLifecycle` route from ledger 137.

Runtime probe, Node 24.16.0:

```text
{"type":"undefined","keys":["execSync"]}
```

## Exact fact dispositions

- ledger 9/87 carrier: adopter demand was not quantified and opportunity cost
  against M11 remained unresolved; the user accepted that premise risk on
  2026-08-31. It is a decision risk, not a product-impact claim.
- map 20 `execSync`: real no-COI test asserts named NotImplementedError.
- map 20 `spawnSync`: absent export gives raw TypeError; existing
  `runtime-js/node-builtins-loud-stub-capability-gaps` now carries it.
- map 32: a third-party iframe without a caller-controlled same origin cannot
  register the same-origin Service Worker required for preview; the hosted
  own-origin route remains `distribution/iframe-embed` scope.

## Rejected-route union

Each row is added separately to `docs/adr/README.md` Declined concepts:

- ADR-0372: COI-default opt-in; async-OPFS selector; catch-all OPFS fallback;
- ADR-0373/0374: SDK Worker with two URLs; private eval/deep imports; public
  Workbench project/terminal reuse; shadow-asset CAS/port; broad `sandbox.exec`;
  queued overlap;
- ADR-0376: host admission boolean; package/project FIFO; Worker per operation;
- ADR-0377: COI Workbench process fabric; Worker per resident; caller-owned
  rebuild/reinstall/preview assembly;
- ADR-0378: async-source census; Worker reset before resident start;
- ADR-0379: independent patches at three ownership sites; pre-start Worker
  replacement is covered by the ADR-0378 reset row;
- pickup ledger 137: separate `onLifecycle` subscription.

Previously exported: SW-delivered COI, heartbeat/journal, Vite identity policy
and docs-site audience exclusion.

## GREEN

Accepted demand/M11 risk, `spawnSync` and no-own-origin facts have exact
carriers. Declined concepts contains the full union above. Backlog/refs,
committed contract-drift and `pnpm pr:check` PASS 24/24 (`test:run` 189.2s,
parity 75.0s); product/test delta 0. Fresh ordinary audit pending.
