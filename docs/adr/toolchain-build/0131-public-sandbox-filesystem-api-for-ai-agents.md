# ADR 0131: Public sandbox filesystem API for AI agents

Status: Accepted
Date: 2026-06-12

> TL;DR: add `Sandbox.fs` / `RuntimeController.fs` read/write RPC backed by the runtime Worker VFS

## Context

M11 embeddable goal: AI-agent-shaped sandbox contract. Current `createSandbox()`
returns runtime + metadata only. Host can push editor saves via legacy
`runtime.writeFile(path, content)`, but no public read path and no awaited write.

Authoritative files live in the runtime Worker realm: `syncMirror()` there backs
`node:fs`, module resolution, OPFS write-through. Page-realm mirrors are UI
helpers, not source of truth.

## Decision

- Add `Sandbox.fs`, exactly `runtime.fs`.
- Add `RuntimeController.fs`:
  - `readFile(path): Promise<Uint8Array>`
  - `readFile(path, 'utf8' | { encoding: 'utf8' }): Promise<string>`
  - `writeFile(path, data: string | Uint8Array): Promise<void>`
- Back with host↔runtime Worker request/response messages:
  `HostMessage { type: 'fs' }` → `WorkerMessage { type: 'fs-result' }`.
- `writeFile` runs in the Worker VFS realm: create parent dirs recursively,
  write bytes, invalidate module loader, await active mirror `flush?.()` before
  resolving.
- Failed FS calls reject with serialized `name`, `message`, optional `code`,
  `path`, `stack`.
- Keep legacy `runtime.writeFile(path, content): void` source-compatible; it
  remains the old fire-and-forget fixture/editor-save path.

Non-goals: exec streaming, preview URL normalization, snapshot/restore/fork,
tree listing, `mkdir`/`readdir`/`stat` public API.

Alternatives:

- Page `syncMirror()` read/write — rejected. Wrong realm; can miss Worker-owned
  OPFS/module-loader state.
- Eval-based `fs` shim — rejected. Injection-prone; conflates user code with host
  control plane.
- Broad FS API now — deferred. M11 slice needs file read/write only.

## Consequences

- Additive public SDK/runtime controller surface; public API → irreversible.
- New protocol messages and worker-side FS RPC helper.
- Public write latency includes OPFS flush when present.
- No compat-matrix regen: no Node/runtime conformance claim changed.
- Residual AI-agent contract work parked in distribution backlog: exec streaming
  + preview URL, snapshot/restore/fork.
