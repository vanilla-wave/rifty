# @riftydev/isolate-host

## Unreleased

- `runCode` runs in a pool of long-lived worker processes, up to 4 calls each, instead of a child process per call (ADR-0563): warm call p50 137 → 13 ms, 8 concurrent calls 1118 → 414 MiB (M3 Pro). API and result shape unchanged. A culprit's memory/time limit ends its own call; neighbours on its worker get their own result. A worker killed from outside no longer rejects its calls at once: they rerun once; a second loss, or a rerun past its deadline, rejects with `code: 'ERR_ISOLATE_HOST_WORKER_LOST'` (no worker stderr in the message). The RSS ceiling is per worker: 256 MiB + 3 × the sum of its calls' `memoryLimitMb`. Idle workers do not keep the consumer alive.
- Intervals keep pace as in Node: a slow interval no longer delays later timers (a 1000 ms timeout after a 10 ms callback at 1 ms: 8.8 s → ~1.0 s), and 20000 × `setInterval(f, 1)` runs instead of ending as `termination: 'memory'` (ADR-0558 Decisions 2026-11-19).
- The guest's `performance.now()`/`timeOrigin` start at the run's bridge setup in the child, not at the child process start (closer to a fresh `node -e`; cross-review 2026-11-18, ADR-0558).
- The guest bundle and the bridge validation come from `@riftydev/isolate-guest` (ADR-0558); `dist/guest.js` is that package's bundle, copied. `runCode` API and install unchanged (the guest clock origin moved: line above). If delivering a timer expiry ever throws, the child now ends that timer instead of throwing in its own event loop.
- New package (ADR-0557): `runCode(code, options?)` runs `code` like `node -e` in a fresh rifty runtime inside an isolated-vm V8 isolate in a disposable clean-env child process; `{stdout, stderr, exitCode}` plus `termination: 'timeout' | 'memory'` and `truncated`.
