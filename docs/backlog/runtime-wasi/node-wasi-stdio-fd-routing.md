---
area: runtime-wasi
status: draft
title: node:wasi WASI ignores Node stdio fd options; default output buffered, never written to fd 1
created: 2026-11-17
why: rifty node:wasi hands Node options (stdin/stdout/stderr = host fd numbers, default 0/1/2) to the runner's callback slots, so default guest output is buffered internally and `stdout: 1` throws, where Node writes to the host fd
sources: [docs/public/compat/wasi.md]
code: [packages/runtime-js/src/builtins/wasi.ts, packages/runtime-wasi/src/wasi.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17), split from
`runtime-wasi/wasi-guest-bytes-decode`. `builtins/wasi.ts:4`
`NodeWasiOptions = WasiOptions & {version}`, `:74` `super(options)`: Node's
fd-number options land in `Wasi` callback slots (`wasi.ts:32-34`). No option →
`wasi.ts:51-52` push to `stdoutBuffer`/`stderrBuffer` (no guest-process route);
number → called as function. `stdin: 0` same shape (`wasi.ts:53`, code read,
not probed).

Probe 2026-11-17, Node v24.16.0 vs rifty `builtins/wasi.ts` via repo `tsx`;
hand-built wasm `_start` → `fd_write(fd, iov@0={16,7}, 1, 8)`, @16
`ef bb bf 68 69 ff 0a` (recipe: `wasi-guest-bytes-decode` §Context):
- `{version:'preview1'}`, fd 1 → Node fd 1 `efbbbf6869ff0a`; rifty start ok,
  process stdout empty.
- `{…, stdout: 1}` → Node fd 1 same bytes; rifty throws
  `ctx.onStdout is not a function`. `{…, stderr: 2}`, fd 2 → Node fd 2 same;
  rifty `ctx.onStderr is not a function`.
- `{…, stdout: 2}` → Node writes guest fd 1 to host fd 2.
- Node `stdout: () => {}` → `ERR_INVALID_ARG_TYPE` (`must be of type number`),
  `'1'` same, `-1` → `ERR_OUT_OF_RANGE`; rifty uses a function as callback
  (`wasi.ts:51`, code read).

Compat: `docs/public/compat/wasi.md:42` `fd_write` ✅ "stdio routed to
`onStdout`/`onStderr`"; `:80` node:wasi note limits only `version`; no stdio ❌.
Fault: corrupt-input (Node fd options unvalidated at the builtin → runner seam).
Dedup: git grep docs/backlog, traps.md, ADR §Declined for
onStdout/onStderr/stdoutBuffer/node:wasi/`stdout: 1`: no match;
`wasi-worker-realm-forward-full-wasi-options` = kernel-worker cwd/stdin, other path.

## Question

Route fd 0/1/2 (and other fd numbers) to guest `process.stdin/stdout/stderr`,
as bytes (shares the `wasi-guest-bytes-decode` carrier question), or loud
`NotImplementedError` for unsupported fds? How sync `fd_read` reads guest
stdin is open.

## Next

Owner runtime-wasi; trigger: a claimed `node:wasi` guest that prints or reads
stdio. RED first: the probes above as parity cases (new
`tools/node-parity-runner/cases/wasi/`), stdout/stderr bytes + option errors vs Node.
