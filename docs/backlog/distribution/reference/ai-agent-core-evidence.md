# Agent core evidence

Baseline main `acf594da9`; accepted goal FIT `5d46fb9debeb067a014bbdc3ac464dbf4a665fe4`.
Oracle: `ai-agent-pi-pickup-evidence.md`, executable `ai-agent-pi-oracle.mjs`.
Seven Node and Chromium cases pass (custom prompt/follow-up recovery, OpenAI
recovery, abort with throw/structured result, ignored abort, replay declaration).

## Initial RED

2026-09-12, Node 24.16.0, Playwright 1.60.0, real browser Workbench/Workers.

```
pnpm --filter @riftydev/agent typecheck
PASS
pnpm test:browser-unit tests/browser-unit/agent-core.spec.ts
5 failed, 0 timeouts (1.1s / 687ms / 488ms / 490ms / 480ms)
All: NotImplementedError: Not implemented: agent.workbench-host
```

The host boots before importing the agent proof; no import/type failure or
mocked Workbench. Only the model's HTTP streaming responses are scripted.
Public API scaffold intentionally throws pending Contract+RED; no implementation.

## Complete preparation RED

```
pnpm test:browser-unit tests/browser-unit/agent-core.spec.ts tests/browser-unit/agent-core-snapshot.spec.ts
12 failed, 0 timeouts
11: NotImplementedError: agent.workbench-host
1: NotImplementedError: agent.browser-preview
```

Includes custom stream/Stop, wall-clock cancellation, CAS conflict, UTF-8 cap,
real companion diagnostics, real iframe and real snapshot-only Vite
build/preview setup. Earlier companion fixture lacked TypeScript and initially
hit Vite's late optimizer reload; fixed the fixture to the installed TypeScript
starter and predeclared lazy Pi optimizer entries. Final run reaches only the
intended unimplemented API errors. A prior in-flight trace archive failure is
not counted as evidence; the final stable-tree run above replaces it.

Packed packaging proof repeats the same snapshot scenario after implementation;
no different reference semantics are inferred from package filenames.

## Host facts

- ProjectTerminal: attach before run; use owner exitCode and await run.close()
  to release its slot. ProjectFiles CAS preserves the exact read version.
- Plain ProjectSession has no diagnostics/SCM; companion supplied explicitly.
- PreviewHandle only gives URL. DOM tools need the host's real frame.
- Packed snapshot-only Workbench is the fixed-deps/no-registry/HMR carrier;
  no-COI full resident cycle and replaced Worker proof stay in its linked child.
