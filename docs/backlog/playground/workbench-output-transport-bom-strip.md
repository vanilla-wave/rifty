---
area: playground
status: draft
title: Workbench output transport drops a leading UTF-8 BOM from guest stdout
created: 2026-11-17
why: owner/page decoders between a guest child and shell ctx / ProjectTerminal use TextDecoder defaults, so EF BB BF the guest wrote never reaches display, redirect or listeners
sources: [ADR-0198, docs/backlog/shell/byte-exact-command-output.md]
code: [packages/workbench/src/glue/run-foreground-child.ts, packages/workbench/src/workers/owner-child-dev-server.ts, packages/workbench/src/glue/pty-client.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17). Shell display taps
keep the BOM (`shell.ts:143,753-754` `ignoreBOM:true`); these decoders don't:

- `run-foreground-child.ts:230-231` — per-stream default decoder, kernel bytes
  (`process-manager.ts:708`) → `ctx.stdout.write(string)` for `node <file>`
  and bins: first BOM per stream lost, also in `> f` / `| od`. String-chunk
  path (:211) flushes and re-arms the strip (test-only today). Decoding before
  the ADR-0198 byte plane also makes non-UTF-8 bytes `EF BF BD` (from code).
- `owner-child-dev-server.ts:126,132-135` — one-shot decode per chunk →
  `workbench-project-runtime.ts:240` `ctx.stdout.write`: BOM lost every chunk,
  char split across chunks → U+FFFD. Its stderr→stdout merge is separate:
  `playground/dev-server-stderr-on-shell-stdout`.
- `pty-client.ts:19,851` — page decode per frame (owner encodes whole strings,
  `pty-server.ts:457`) → `project-terminal.ts:242` output listeners.

Probe (Node v24.16.0, scratch /tmp dir; WHATWG TextDecoder for rifty shapes):
`node -e "process.stdout.write(Buffer.from([0xef,0xbb,0xbf,0x68,0x69,0x0a]))" | od -An -tx1`
→ `ef bb bf 68 69 0a`. Stream `[EF BB BF 61]`, `decode()+'s'`, `[EF BB BF 62]`
→ `61|73|62`; one-shot `[EF BB BF 78]` twice → `78`,`78`; one-shot `E2 82`+`AC`
→ `fffd fffd`; `ignoreBOM:true` → `feff 78`. Rifty end-to-end not run.
Fault: corrupt-input (lossy decode) on owner↔child / owner→page Worker
boundary (model: no partial loss). Dedup: grepped docs/backlog, traps.md,
ADR §Declined for these files, TextDecoder, BOM, byte-exact; nearest
`shell/byte-exact-command-output`, `terminal/byte-pty-mode-umbrella` — neither
covers these decoders.

## Next

Owner playground (workbench glue/workers); trigger: guest BOM/non-UTF-8 stdout
via shell, dev-server log or ProjectTerminal listener. RED first:
`run-foreground-child.test.ts` byte chunk `EF BB BF 68 69 0A` → ctx.stdout gets
`ef bb bf 68 69 0a` (od above); same input for dev-server log (two chunks) and
a pty-client `'\ufeffx'` frame.
