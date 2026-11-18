# @riftydev/isolate-host

## Unreleased

- New package (ADR-0557): `runCode(code, options?)` runs `code` like `node -e` in a fresh rifty runtime inside an isolated-vm V8 isolate in a disposable clean-env child process; `{stdout, stderr, exitCode}` plus `termination: 'timeout' | 'memory'` and `truncated`.
