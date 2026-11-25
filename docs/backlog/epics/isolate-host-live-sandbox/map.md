# Map — isolate-host-live-sandbox

## Items

1. `distribution/isolate-host-sandbox-capture-outside-guest-realm` — owned by
   `epics/isolate-host-sandbox-template` (its map item 6, I7) since 2026-11-25; this goal closes
   there, when that unit lands (or the user narrows I1).

## Open questions

None: the `owner: user` question on behavior divergences was answered 2026-11-23 (goal.md `amend:` lines; the second covers the lifecycle class).

## Closes elsewhere

- The `isolate-host-fs-snapshot` goal's residual "a snapshot refuses NUL names and times outside
  Date" is closed in rifty's fs by this branch: `fs-path.ts` (Node's `nullCheck`) and
  `fs-times.ts` (utimes as Node 24.16.0) — guest `node:fs` and the sandbox's host ops no longer
  create such values (a consumer writing a `MemoryFsSync` directly still can; the snapshot refuses
  it by name).

## Out of scope

- The library template (`createSandbox({ template })` → `NotImplementedError('isolate-host.sandbox-template')`).
- Web API shims (`URL`, `structuredClone`, web streams, `AbortController`, `EventTarget`): loud ceilings as in `runCode`; their own ROADMAP direction.
- ESM: an ESM entry or module (`.mjs`, `"type": "module"`, ESM syntax in a typeless `.js`) → `NotImplementedError('isolate-host.esm')` + compat ❌.
- `exec` options `env`, `cwd`, `stdin` → `NotImplementedError('isolate-host.sandbox-exec-<option>')`; shell syntax (the path is one file path, never parsed).
- Keeping a killed run's partial writes (whole-run rollback, compat ⚠️); a host-disk directory model (not built, ADR critic only).
- Text of `node file.js` diagnostics (positions, header, caret, footer, `SyntaxError` shape, `Cannot find module` header): the runtime-js diagnostics goal; pinned ⚠️ here.
- npm publication; RPC transport; per-tenant worker affinity; `process.exit()` from a microtask and the suite flake (neighbour threads).
