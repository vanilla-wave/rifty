---
area: runtime-wasi
status: draft
title: WASI syscalls decode guest bytes to UTF-8 strings, dropping BOMs and invalid bytes
created: 2026-11-17
why: fd_write stdout/stderr and path args round-trip guest bytes through a default TextDecoder, so a leading BOM vanishes per call and non-UTF-8 bytes become U+FFFD; Node node:wasi passes the bytes through
sources: [docs/adr/runtime-wasi/0038-wasiprocesshandle-kernel-adapter-for-wasi-guests.md, docs/backlog/toolchain-build/reference/browser-honest-coverage.md]
code: [packages/runtime-wasi/src/syscalls/shared.ts, packages/runtime-wasi/src/syscalls/fd.ts, packages/runtime-wasi/src/wasi.ts, packages/runtime-wasi/src/worker-entry.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17), outside its scope.
`shared.ts:179` `dec = new TextDecoder('utf-8')` (strips BOM, non-fatal,
non-streaming) feeds `fd.ts:108-109` `fd_write`: each stdout/stderr iovec
decoded alone → string callback `WasiOptions.stdout/stderr` (`wasi.ts:32-33`)
→ `worker-entry.ts:142-147` → `makeStdioWriter` (`:67-77`) re-encodes for the
kernel port (takes bytes). Also `shared.ts:224` `resolveRel` (every path
syscall, `path.ts:68,177,205,219,236,263-264`). So BOM dropped at the start of
every iovec; invalid UTF-8 → U+FFFD; a char split across iovecs/calls breaks
(code read, not probed).

Probes 2026-11-17, Node v24.16.0 `node:wasi` vs rifty `Wasi` (repo `tsx`).
Hand-built wasm: one `wasi_snapshot_preview1` import, exported 1-page
`memory`, `_start` = `i32.const` args → `call` → `drop`, data segments hold
iovec/bytes. Node stdout `| xxd -p`; rifty `stdout` callback re-encoded
(TextEncoder); paths: Node `preopens {'/': './pre'}`, rifty `MemoryFsSync`.
- `fd_write(1, iov@0={16,7}, 1, 8)`, @16 `ef bb bf 68 69 ff 0a` → Node
  `efbbbf6869ff0a`, rifty `6869efbfbd0a`.
- `path_create_directory(3, 16, 4)`, @16 `ef bb bf 64` → Node dirent code
  points `feff 64`, rifty `64`.

Compat: `docs/public/compat/wasi.md:42` `fd_write` ✅, `:43`
`path_create_directory` ✅ (+ other `resolveRel` rows `:44`/`:47`/`:49`/`:50`/`:52`)
claim no lossy-decode caveat: overclaim.
Fault: corrupt-input (lossy decode) at the guest-memory → host boundary.
Dedup: git grep docs/backlog, traps.md, ADR §Declined for
fd_write/onStdout/resolveRel/WasiOptions/TextDecoder/BOM: no match;
`browser-honest-coverage.md` BT-11 names the same decode sites, shared-memory
hazard only. `node:wasi` stdio routing split out:
`runtime-wasi/node-wasi-stdio-fd-routing`.

## Question

Byte-exact stdout needs a byte channel, but exported `WasiOptions.stdout/stderr`
(`index.ts:1`) is `(chunk: string) => void`: public API change (ADR) or another
carrier? Paths: VFS keys are strings; how non-UTF-8 path bytes map is open (rifty
vs Node on invalid path bytes not probed).

## Next

Owner runtime-wasi; trigger: a claimed WASI guest with binary/non-UTF-8/BOM
stdout or such file names. RED first: both probes as parity cases (new
`tools/node-parity-runner/cases/wasi/`), byte-compared vs Node.
