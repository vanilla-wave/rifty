# Compatibility matrix — M10 Tooling

Status of M10 foundations: `fs.watch`, WebSocket, dev-server, shell, preview bridge.

| Feature | Status | Notes |
|---|---|---|
| `fs.watch(path, opts, cb)` (file) | ⚠️ | Polling-based, default 250 ms; emits `'rename'` / `'change'` |
| `fs.watch(path, opts, cb)` (directory) | ⚠️ | Polling; reports added/removed/modified children by filename |
| `fs.watch` with `AbortSignal` | ✅ | Aborting closes the watcher |
| `fs.watchFile(path, opts, listener)` | ⚠️ | Polling; listener receives `curr` / `prev` `Stats`-shaped objects |
| `fs.unwatchFile(path, listener?)` | ✅ | Removes specific listener or all listeners |
| `WebSocket` (browser-shape, in-process) | ⚠️ | Same-realm pairing with `WebSocketServer`; real-TCP `WebSocket` is a follow-up |
| `WebSocketServer` (Node `ws`-shape) | ⚠️ | In-process; `broadcast`; `'connection'` / `'message'` / `'close'` events |
| `http.Server` WS/SSE upgrade (`server.on('upgrade')`, `res.assignSocket`) | ❌ | Owned by feature 07 (opencode facade); the port-registry bridge carries buffered+chunked HTTP only (ADR-0040/0048), no socket hijack. `ServerResponse` exposes no `assignSocket`; an upgrade is never silently routed through the buffered `'request'` path (negative test `server.test.ts`) |
| Service Worker `/preview/<port>/*` interceptor | ✅ | Posts to window client over MessageChannel; window resolves via port registry |
| Dev-server (`examples/vite-like-dev`) — HTML+JS serving | ✅ | From VFS; injects HMR client into `<body>` |
| Dev-server — fs.watch-driven HMR broadcast | ✅ | Watches root + `src/`; emits `{ type: 'update', path }` |
| Dev-server — TS/JSX transformation via esbuild.wasm | ❌ | Pending — needs M8 esbuild.wasm vendor |
| Dev-server — ESM rewriting for bare specifiers | ❌ | Pending |
| Real upstream Vite (`npm install vite && npm run dev`) | ❌ | Many transitive deps + esbuild.wasm dependency |
| Shell tokenizer (quotes, env-assignments, `>`/`>>`) | ✅ | |
| Shell single vs double quote semantics (`'…'` literal, `"…"` expanding) | ✅ | `'$X'` stays literal; `"$X"` expands; limited `\$`/`\"`/`\\`/`` \` `` escapes |
| Shell variable expansion (`$VAR`, `${VAR}`) | ✅ | Unknown vars expand to empty string (POSIX); no word splitting after expansion |
| Shell `${VAR:-default}` / `${#VAR}` / `${VAR%suf}` etc. | ❌ | Throws from tokenizer — loud, not silent |
| Shell built-ins (`pwd`/`cd`/`ls`/`cat`/`echo`/`mkdir`/`rm`/`env`/`touch`) | ✅ | `touch` updates mtime through `FsSync.utimes` (ADR-0029); works on every backend |
| `node:fs.utimesSync` / `fs.promises.utimes` | ✅ | Routes through `FsSync.utimes` (ADR-0029); OPFS uses an in-memory side-table |
| Shell pipes (`a \| b`) | ❌ | Pending |
| Shell input redirect (`cmd < file`) | ❌ | Throws `NotImplementedError('shell.input-redirect')` — M12 work item, use bash via wasi |
| Shell command substitution `$(…)` / `` `…` `` | ❌ | Not parsed; the tokenizer emits literal characters |
| Shell glob expansion (`*`, `?`, `[abc]`) | ❌ | Not parsed |
| Editor → VFS sync (`RuntimeController.writeFile`) | ✅ | Push from playground main thread into in-Worker VFS |

## Known limitations (M10)

- `fs.watch` is polling-only; default interval is 250 ms (override via options).
  Native event sources don't exist in our environment (in-memory VFS, OPFS without
  notification API).
- WebSocket is in-process only. The API surface matches the browser `WebSocket`
  and Node `ws` so the day we wire it to a real socket — likely through a
  Service-Worker-mediated `fetch` upgrade or a `BroadcastChannel`-based main
  thread bridge — user code doesn't change.
- Service-Worker route interception is wired but cross-context HMR (iframe
  fetching `ws://localhost:N/__hmr` against a Worker-side server) requires the
  dev server to run in the main-thread realm, since native `WebSocket` can't
  reach a Worker without a network hop. The playground's Dev Mode currently
  runs the dev server in the main-thread realm for this reason.
- `worker_threads.Worker` falls back to **same-realm** execution when the
  kernel `spawnWorker` capability is unavailable (no SAB IPC, no configured
  `kernelWorkerUrl`). The same-realm path runs the worker script in the
  parent's realm with no `globalThis` isolation and no separate module
  loader — `workerData` and `parentPort` still propagate, but a script that
  calls `require()` will resolve against the parent's loader, not its own.
  A one-shot warn fires on first fallback. To get real Workers: ensure
  cross-origin isolation (SAB) and call `kernel.setKernelWorkerUrl(...)` at
  host boot (ADR-0011 phase 2). Follow-ups doc item #13.
