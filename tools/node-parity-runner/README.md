# node-parity-runner

Golden-image harness: takes a "case" (setup + code + expected stdout), runs it both in real Node and in our runtime, diffs.

This is the **gold standard** described in PROJECT_PLAN.md §5.2 — every Node-compatible behaviour gets a parity case where practical. Cases drift toward the conformance suite when a behaviour is well understood; they stay here when we want a head-to-head against Node.

## Case kinds

A case's `kind` selects what the rifty side loads:

- `'cjs'` (default) / `'esm'` — module-shape parity. The rifty side runs through `@rifty/runtime-js/loader` only (no `@rifty/net`). Covers `node:path`, `node:buffer`, `node:util`, `node:querystring`, `node:events`, `node:url`, streams, fs, etc.
- `'http'` — opt-in `@rifty/net` registration mode. The rifty side also imports `@rifty/net/register-builtins` so `require('node:http')` resolves, and both runtimes expose a normalised request-driver global:

  ```ts
  __riftyHttpRequest(port, path, init?) =>
    Promise<{ status, statusText, contentType, body }>
  ```

  On the Node side the driver is a real `http.request` to `127.0.0.1:<port>`; on the rifty side it is `dispatchToPort(port, new Request('http://preview.local:<port><path>'))`. This is the only way to exercise rifty's `node:http` *server* surface head-to-head against Node — the default modes never register `node:http` (it lives in `@rifty/net`, which the runner does not import by default). The runner is a `tools/` harness already permitted to reach into higher layers (precedent: the WASI cases bind `@rifty/runtime-wasi` via `@rifty/shadow-registry`).

  An `'http'` case writes its handler once (`createServer()` + `server.on('request', …)` + `server.listen({ port }, cb)`), then drives its own server via `__riftyHttpRequest` and prints from the normalised response. Print only the fields both transports agree on byte-for-byte (status code, the explicit headers you set, body bytes) — real Node injects `Date`/`Connection`/`Keep-Alive` the port-registry model has no socket to produce.
