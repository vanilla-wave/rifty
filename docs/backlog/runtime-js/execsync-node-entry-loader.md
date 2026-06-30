---
area: runtime-js
status: ready
title: Route execSync's child through the node-entry bootstrap (shebang + relative imports)
created: 2026-06-14
why: child_process.spawn('node', …) is wired to the node-entry bootstrap (ADR-0137) so a shebang'd / relative-import script goes through the module loader, while execSync's recursive runner still builds a raw kind:'source' spec — inconsistent dispatch. P6a (ADR-0150) landed RIFTY_REMOTE_FS + fs.* sync-RPC, so the historical blocker is gone; this is now an entry-kind-parity fix.
user_story: As a developer whose code calls `execSync('node scripts/build.js')` on a script with a `#!` shebang or relative `import './config.js'` (or `fs.readFileSync('./pkg.json')`), I want it to run like `child_process.spawn` does (via the module loader, seeing the owner filesystem), but today execSync's recursive runner uses the raw kind:'source' path so it chokes on the shebang, can't resolve relative imports, and reads an empty mirror.
sources: [ADR-0137, ADR-0143, ADR-0150, M11]
code: [packages/runtime-js/src/ipc/handlers.ts, packages/runtime-js/src/ipc/recursive-runner.ts]
---

## Context

`installRuntimeJsExecSyncHandler` (`ipc/handlers.ts`) builds `{ kind:'source', code, sourceUrl }` carrying the script BYTES inline and hands it to the recursive runner, which spawns a kernel Worker whose `kind:'source'` path (`new AsyncFunction`) throws on a `#!` line and never routes the script's relative `import()`/`require()` to the VFS loader — the exact gap ADR-0137 fixed for `child_process.spawn` via the `kind:'url'` node-entry bootstrap.

Two constraints previously blocked a straight flip; both are now resolved:
1. **Conformance runs in Node.** `tests/conformance/builtins/child_process.test.ts` executes the handler's spec in Node (an injected `runWorker` stub), where there is no kernel Worker / `kind:'url'` bootstrap. → the recursive runner must own the entry-kind decision (browser → node-entry bootstrap; Node → loader-run the source in-process), not the handler.
2. **kind:'url' child read an empty store.** The old `kind:'source'` carried bytes; a naive `kind:'url'` child read its OWN empty mirror → ENOENT (regressed `tests/e2e/execsync-sab.spec.ts`). → P6a (ADR-0150) shipped `RIFTY_REMOTE_FS=1` + `fs.*` sync-RPC + `installRemoteSyncFs` + the owner-child spawn pattern (`owner-child-bin-executor`), so a node-entry child reads the OWNER store. execSync runs in the owner realm (shell moved there, ADR-0146), which serves `fs.*` — so the child can use remote-fs. The infra the prior draft waited on now exists.

## User scenario

A developer's build step shells out to a Node sub-script: `execSync('node scripts/gen.js')`, where `scripts/gen.js` starts with `#!/usr/bin/env node`, does `import './config.js'` (relative), and `fs.readFileSync('./package.json')`. Today execSync's child (`new AsyncFunction`) throws a `SyntaxError` on the `#!` line, cannot resolve `./config.js`, and reads an empty mirror → `ENOENT`. After this item `gen.js` runs through the module loader against the owner store — shebang stripped, relative import resolved, sibling files read — exactly like `child_process.spawn('node', ['scripts/gen.js'])` already does.

## Acceptance

- E2E (browser COI, owner realm): `execSync('node /scripts/build.js')` where build.js starts with `#!/usr/bin/env node` runs (shebang stripped, no SyntaxError); build.js with `import './config.js'` resolves against the owner store; build.js doing `fs.readFileSync('./pkg.json')` reads the owner store (a node child sees the parent fs), not ENOENT.
- Existing `tests/e2e/execsync-sab.spec.ts` stays green: non-UTF-8 stdout bytes (`[0xff,0xfe,0x00]`) round-trip byte-exact; child exit code propagates.
- Conformance (Node-hosted substitute) stays green: the runner loader-runs the script in-process (shebang + relative imports honored) with no kernel Worker / `kind:'url'` bootstrap.
An implementation that strips the shebang only in one path, or makes the child read an empty mirror, fails this.

## Parity cases

- x.js = `#!/usr/bin/env node\nprocess.stdout.write('ok')` → stdout `ok` (shebang neither executed nor echoed; not a SyntaxError) — Node `Module._compile` shebang strip.
- x.js with `import './util.js'` (relative ESM) → resolves + runs against the owner VFS, identical to `spawn('node', ['x.js'])`.
- x.js with `require('./util.js')` (relative CJS) → resolves against the owner VFS.
- x.js with `fs.readFileSync('./data.json')` (sibling file present in the owner store) → reads it, not ENOENT against an empty realm mirror.
- non-UTF-8 stdout → byte-exact (existing guard, must stay green).
- non-zero `process.exitCode` / a thrown error → `execSync` throws with `status` set and stderr surfaced (Node surfaces child stderr only on failure).

## Out of scope

- Async `child_process.exec`/`execFile` node-entry routing — the generic worker spawn path, tracked by `runtime-js/generic-spawn-worker-remote-fs` (sibling; shares the realm `fs.*`-capability check).
- `execSync` from a realm that does NOT serve `fs.*` (non-owner) — keeps the existing `kind:'source'` in-realm path (plain scripts work; shebang/relative-import still loud-fail there). The node-entry route requires the spawning realm to serve `fs.*` (only the owner does today, ADR-0150). Documented, not a regression.
- `execSync` of a NON-`node` binary (shell builtins / `.bin`) — unchanged (owner-child bin executor, ADR-0150 P6a).

## Decisions

- The recursive runner (its browser vs Node injection seam) owns the entry-kind decision: a realm that serves `fs.*` (the owner) → spawn a node-entry child `kind:'url'` with `RIFTY_REMOTE_FS=1` reading the owner store via the P6a `fs.*` sync-RPC (same spawn shape as `owner-child-bin-executor`); Node-conformance → loader-run the source in-process. Both go through the module loader (shebang strip + relative resolve). The handler stops embedding script BYTES; it passes the path.
- No new ADR: phased delivery of ADR-0143 D, explicitly anticipated by the ADR-0137/0143/0144/0146 correction notes ("execSync node-entry residual remains separate").
- Shares the realm `fs.*`-capability check with `generic-spawn-worker-remote-fs`; that item owns the async-spawn path, this owns execSync's recursive runner.
- REVERSIBLE — internal execSync dispatch; CHANGELOG line. No public API change.

## Reversibility

REVERSIBLE — internal execSync dispatch over the shipped ADR-0150 owner-child + remote-fs mechanism; no public API change.
