# @riftydev/isolate-host

## Unreleased

- The guest bundle and the bridge validation come from `@riftydev/isolate-guest` (ADR-0558); `dist/guest.js` is that package's bundle, copied. `runCode` API, install and output unchanged. A timer expiry delivered to an already disposed isolate now ends that timer inside the child instead of throwing there.
- New package (ADR-0557): `runCode(code, options?)` runs `code` like `node -e` in a fresh rifty runtime inside an isolated-vm V8 isolate in a disposable clean-env child process; `{stdout, stderr, exitCode}` plus `termination: 'timeout' | 'memory'` and `truncated`.
