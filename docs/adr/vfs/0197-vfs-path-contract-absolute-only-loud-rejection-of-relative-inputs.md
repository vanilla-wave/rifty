# ADR 0197: VFS path contract: absolute-only, loud rejection of relative inputs

Status: Accepted
Date: 2026-07

> TL;DR: `normalizeAbsolute` no longer silently roots relative paths (`'foo'` → `'/foo'`); every `Vfs`/`FsSync` entry point now throws on a relative input. cwd resolution is the CALLER's job (fs-path kit in runtime-js, `resolve(ctx.cwd, …)` in shell).

## Context

Review 2026-07-05: `fs.createReadStream('config.json')` at cwd `/workspace` silently
read `/config.json` — the stream factories skipped cwd resolution, and the VFS
*hid* the bug by quietly coercing the relative path to root-anchored. Every fs
surface that forgets to resolve gets this failure mode for free, and it is
invisible at cwd `/` (where resolved and unresolved coincide — the parity
runner's old pinned cwd). Silent coercion is exactly the kind of
plausible-but-lying fallback the fidelity rules forbid.

Audit (2026-07-05): all production callers (shell, runtime-js fs kit,
module-loader, git adapter, npm-client, ts-language-service, runtime-wasi,
eddy, playground) already pass absolute paths; 108 `loadFixture` call sites all
use absolute keys; exactly one vfs unit test asserted the old coercion.

## Decision

- The VFS layer accepts ONLY absolute POSIX paths. `normalizeAbsolute` throws
  `Error('VFS path must be absolute …')` on any input that does not start with
  `/` (dot-segments inside absolute paths still normalise).
- cwd anchoring lives strictly ABOVE the VFS: runtime-js `fs-path.ts`
  `resolvePath` (process.cwd), shell `resolve(ctx.cwd, …)`, WASI preopen join.
- A new fs entry point that forgets to resolve now fails its first
  relative-path test loudly instead of reading the wrong file.

## Consequences

- The fs-streams class of bug (silent wrong-file reads/writes) is structurally
  impossible below the resolution layer.
- One vfs unit test updated from asserting coercion to asserting the throw.
- Backends keep their internal `normalizeAbsolute` calls as a cheap assert —
  the throw is the enforcement point, not a new validation pass.
