# No-COI closure export proof — evidence (2026-09-04)

## RED

Fresh read-only audit of CLOSE @ `49142af19`:

- ledger line 7 and map lines 29–31 had no exact durable disposition;
- ADR-0378 rejected all-async-source census and Worker reset before every
  resident start, but neither appeared in Declined concepts.

## Exact dispositions

- ledger 7 carrier: `util-types.ts:27,31` are TypeScript predicate positions,
  erased at runtime; adjacent runtime checks compare brand strings. No bare
  `SharedArrayBuffer` global read or product gap exists there.
- map 29 `ring-less spawn` — dropped: kernel redesign outside tier `works`;
  no code/spike, while `kernel/process-equals-web-worker` retains the real
  process-isolation scope.
- map 30 `async remote-fs` — dropped: outside goal, no trigger, code or spike.
- map 30 `snapshot children` — dropped: outside goal, no trigger, code or spike.
- map 30–31 `sync-XHR-to-SW` — dropped: cross-worker sync route has zero code
  and zero spike; goal deliberately chose one in-realm Worker.
- ADR-0378 all-async-source census — declined: no complete browser async
  handle census and it rejects harmless Vite cleanup.
- ADR-0378 new Worker before every initial resident start — declined: changes
  existing-Worker semantics and emits an observable reset.

## GREEN

The four one-off facts now have exact carrier/drop entries above. Declined
concepts contains both ADR-0378 alternatives. `pnpm backlog:check`,
`pnpm refs:check`, committed `pnpm check:contract-drift` and `pnpm pr:check`
PASS; final gate 24/24 (`test:run` 224.4s, parity 75.7s). Ordinary review @
`c6d8b480b` passed 2/2 coverage with 0 findings and product/test delta 0 after
one infrastructure-invalid empty-coverage output was retried once.
