# node-parity-runner

Golden-image harness: takes a "case" (setup + code + expected stdout), runs it both in real Node and in our runtime, diffs.

This is the **gold standard** described in `docs/process/rules/testing.md` — every Node-compatible behaviour gets a parity case where practical. Cases drift toward the conformance suite when a behaviour is well understood; they stay here when we want a head-to-head against Node.

## Case kinds

A case's `kind` selects what the rifty side loads:

- `'cjs'` (default) / `'esm'` — module-shape parity. The rifty side runs through `@riftydev/runtime-js/loader` only (no `@riftydev/net`). Covers `node:path`, `node:buffer`, `node:util`, `node:querystring`, `node:events`, `node:url`, streams, fs, etc.
- `'http'` — opt-in `@riftydev/net` registration mode. The rifty side also imports `@riftydev/net/register-builtins` so `require('node:http')` resolves, and both runtimes expose a normalised request-driver global:

  ```ts
  __riftyHttpRequest(port, path, init?) =>
    Promise<{ status, statusText, contentType, body }>
  ```

  On the Node side the driver is a real `http.request` to `127.0.0.1:<port>`; on the rifty side it is `dispatchToPort(port, new Request('http://preview.local:<port><path>'))`. This is the only way to exercise rifty's `node:http` *server* surface head-to-head against Node — the default modes never register `node:http` (it lives in `@riftydev/net`, which the runner does not import by default). The runner is a `tools/` harness permitted to reach into higher layers.

  An `'http'` case writes its handler once (`createServer()` + `server.on('request', …)` + `server.listen({ port }, cb)`), then drives its own server via `__riftyHttpRequest` and prints from the normalised response. Print only the fields both transports agree on byte-for-byte (status code, the explicit headers you set, body bytes) — real Node injects `Date`/`Connection`/`Keep-Alive` the port-registry model has no socket to produce.

- `'ts-esm'` — TypeScript-on-import ESM mode. The case `code` (and any `.ts` `setup.files`) is written verbatim; the entry is `main.ts`. The Node side runs `main.ts` through the vendored `tsx` CLI — a full TypeScript transform, not Node's native strip-only TypeScript support (ADR-0132). The rifty side builds `createModuleLoader(vfs, { cwd, workspace, transformSource })`; the Node-only harness injects workspace esbuild to strip types / lower JSX before the AST ESM rewrite. Product esbuild activation is proved separately through the browser registry adapter.

  The harness mounts a minimal `package.json` (`{ "type": "module" }`) into the work dir on both sides so the resolver classifies `.ts` as ESM (otherwise it falls to CJS and `require()` of a `.ts` throws the directed F02-T4 error); a `setup.files` `package.json` wins if the case supplies its own.
- `'worker-env'` — physical kernel-backed `worker_threads.Worker` mode for ADR-0267. It runs production typed entry bootstrap and Node process installation in an isolated native Worker; the ordinary same-realm runner cannot prove guest-env separation.
