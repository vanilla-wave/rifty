---
area: runtime-js
status: draft
title: node-builtin loud-stub capability gaps — throwing and absent Node surfaces
created: 2026-06-13
why: These node: builtin features throw NotImplementedError — a real runtime capability absence a consumer hits when running ordinary npm code; tracked here as the capability limitation itself, distinct from the compat-visibility item which only proposes ❌ matrix rows.
user_story: As a dev running an npm package that reaches `tls.createServer`, `dns.resolve`, full readline TTY editing, `v8.serialize` or `dgram.createSocket`, I want it to run — but today these `node:` builtins throw `NotImplementedError` (honest loud stubs, parked by design).
sources: [ADR-0010, AGENTS.md]
code: [packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/builtins/tty.ts, packages/runtime-js/src/builtins/os.ts, packages/runtime-js/src/builtins/perf_hooks.ts, packages/runtime-js/src/builtins/vm.ts, packages/runtime-js/src/builtins/string_decoder.ts, packages/runtime-js/src/builtins/misc-stubs.ts, packages/runtime-js/src/builtins/null-net-stubs.ts, packages/runtime-js/src/builtins/crypto.ts, packages/runtime-js/src/builtins/fs.ts]
---

## Context

Confirmed throwing feature-ids (honest loud stubs per the no-silent-stubs rule): `crypto.Hash.copy`, `dgram.createSocket`, `fs.openSync.O_SYNC`, `os.setPriority`, `perf_hooks.monitorEventLoopDelay` + `perf_hooks.PerformanceObserver.observe`, `tls.createServer` (+ connect/Server/TLSSocket), `tty.ReadStream`/`tty.WriteStream`, `v8.getHeapStatistics`/`serialize`/`deserialize`, `vm.createContext.{name,origin,codeGeneration,microtaskMode}` / `vm.compileFunction.parsingContext` / `vm.context.var-pattern`; plus `dns.resolve*` (non-localhost — `lookup('localhost')` works, so dns is honestly a subset), readline raw/keypress/promises/full-editing surfaces (line/question `createInterface` and cursor helpers are implemented), and `string_decoder` non-utf8. These are not silent — they throw — but they are a genuine capability absence: an npm package that reaches any of them fails at runtime. This item records the absence as a tracked limitation; `process-meta/compat-matrix-coverage-debt` is the doc/compat-visibility half (publishing ❌ rows, no implementation). Promoted implementation trackers exist for `zlib` (`runtime-js/zlib-web-compression-subset`) and fetch/DoH-backed `dns.resolve*` (`runtime-js/dns-resolve-fetch-subset`).

**Absent — not even a loud throw (a raw `TypeError: … is not a function`, WORSE than a NotImplementedError):** `child_process.spawnSync` (2026-09-04 runtime probe: export `undefined`, only `execSync` among `*Sync` keys), `accessSync` (only the callback/promise `access` exist), callback-form `fs.rm` (only `rmSync`/`promises.rm`), `chmod`/`chown`/`lchmod`/`lchown`, `symlink`/`link` (symlink stays governed by ADR-0050's no-symlink model — `readlink` exists), `statfs`/`statvfs`, `readv`/`writev`. Per the no-silent-stub rule these should at least throw a named `NotImplementedError` (+ compat ❌); `accessSync` + callback `rm` are cheap + common → implement on demand. (Reachability rose with ADR-0150 — arbitrary CLIs now run in a child and hit these.)

## Options or Next

Parked by design: "Full Node compat" and native modules are explicit non-goals (`AGENTS.md` §Mission). Default is to keep these as honest loud throws, not to build them. Promote a specific feature to its own active impl item only on concrete consumer demand; `dns.resolve*` has a dedicated backlog file and the first readline subset is delivered. Networked implementations still need an ADR when they extend ADR-0010's loud-throw stance. Per feature, write a failing parity/ceiling case pinning the current throw shape first, then implement the subset. Keep the compat ❌ rows (`process-meta/compat-matrix-coverage-debt`) in sync so the public matrix matches these throws.

## Reversibility

REVERSIBLE to record the limitation and to keep the loud throws. Implementing any networked one (tls termination, dns over DoH) is IRREVERSIBLE — needs an ADR extending ADR-0010.
