# @riftydev/isolate-host

## Unreleased

- The guest's `performance.now()`/`timeOrigin` start at the run's bridge setup in the child, not at the child process start (closer to a fresh `node -e`; cross-review 2026-11-18, ADR-0558).
- The guest bundle and the bridge validation come from `@riftydev/isolate-guest` (ADR-0558); `dist/guest.js` is that package's bundle, copied. `runCode` API, install and output unchanged. If delivering a timer expiry ever throws, the child now ends that timer instead of throwing in its own event loop.
- New package (ADR-0557): `runCode(code, options?)` runs `code` like `node -e` in a fresh rifty runtime inside an isolated-vm V8 isolate in a disposable clean-env child process; `{stdout, stderr, exitCode}` plus `termination: 'timeout' | 'memory'` and `truncated`.
