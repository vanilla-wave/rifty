# Isolate host (`@riftydev/isolate-host`, ADR-0557)

`runCode(code)` runs `code` like `node -e <code>` on Node 24. Tests:
`packages/isolate-host/tests/` (vitest project `isolate-host`). The oracle is a live `node -e`
child.

| Surface | Status | Notes |
|---|---|---|
| `{stdout, stderr, exitCode}` of CommonJS `node -e` code | ✅ | Corpus parity `parity.test.ts`: console, byte `process.stdout.write`, UTF-8, `exit`/`exitCode`/`'exit'`, event-loop order, fs on the in-memory VFS, Buffer, path/util/crypto hashes/events, uncaught throw/rejection diagnostics (canonical `[eval]` projection) |
| Fresh instance per call | ✅ | `isolation.test.ts` |
| Limits: time / isolate heap / V8 fatal OOM / child RSS / output cap | ✅ | `termination: 'timeout' \| 'memory'`; RSS is a sampled watchdog that can overshoot by one allocation step; output past the cap is dropped (`truncated`). `limits.test.ts` |
| Network: `fetch`, `WebSocket`, `node:http`/`https`/`net` | ❌ | `NotImplementedError('isolate-host.<api>')`; `node:tls`/`dgram`/`http2` keep rifty's loud stubs. `egress.test.ts` |
| `URL`, `URLSearchParams`, `structuredClone`, web streams, `AbortController`/`AbortSignal`, `Event`/`EventTarget`/`CustomEvent`, `Blob`/`File`, `Request`/`Response`/`Headers`/`FormData`, `MessageChannel`/`MessagePort`/`BroadcastChannel`, web-stream reader/controller/strategy classes, `CloseEvent`/`MessageEvent`, `URLPattern`, `Crypto`/`CryptoKey`/`SubtleCrypto`, `Navigator` and `navigator.*`, `Performance*` classes, `crypto.subtle`, `performance.mark`/`measure`/`nodeTiming`/… | ❌ | `NotImplementedError('isolate-host.<api>')`; successor goal (`docs/ROADMAP.md` M14 B) |
| Static members of those ceiling globals (`AbortSignal.timeout`, `URL.canParse`, `Response.json`, …) | ❌ | `TypeError: … is not a function` — not the named gap; constructing or calling the global itself is |
| ESM syntax in `-e` (static `import`, top-level `await`) | ❌ | Node 24 detects and runs it as a module; here `NotImplementedError('isolate-host.node-eval-esm')`. `backlog/runtime-js/node-cli-esm-eval-context` |
| `import()` | ❌ | Rejects a plain `Error` (name `Error`, not `NotImplementedError`) `Not implemented: isolate-host.dynamic-import …`, no host frames. The loop waits for it as Node's does: process listeners, `'exit'` code and `process.exit()` behave as for Node's failing import; unhandled → exit 1 (stderr is the rifty diagnostic, not Node's `ERR_MODULE_NOT_FOUND`) |
| Unhandled rejection with other timers pending | ⚠️ | rifty's eval lifecycle fails at the next drain check, not at once: a `.catch` attached from a later task still runs before exit 1 (Node exits first). `backlog/runtime-js/node-eval-unhandled-rejection-timing` |
| `node -e` builtin-module globals (`path`, `fs`, `util`, `crypto`, …) | ✅ | Lazy getters with Node v24.16.0's list; a write replaces them. Corpus `builtin-module-globals`; the guest has every global name `node -e` defines (live list test) |
| `console.log` / `util.inspect` layout | ⚠️ | No line breaking or grouping of long arrays/objects; typed arrays print as objects; default depth 3. `backlog/runtime-js/util-surface-completions` |
| Uncaught non-`throw` error diagnostic (`undefined.x`) | ⚠️ | No `[eval]:1` source header/caret. `backlog/runtime-js/node-eval-non-throw-diagnostic-header` |
| `unhandledRejection` listener arguments | ⚠️ | The reason is an isolated-vm copy, and `promise` is `undefined`; a non-`Error` reason arrives as a generic `Error` |
| Identity: `process.version`, `os.platform()`, `process.cwd()` (`/workspace`), `process.argv`, `process.env` (empty), stdin | ⚠️ | rifty's, not the host's |
