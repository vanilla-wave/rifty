---
area: runtime-js
status: parked
title: node-builtin loud-stub capability gaps — tls/dns(non-localhost)/readline/perf_hooks/v8/vm/dgram/tty/string_decoder/os.setPriority/crypto.Hash.copy/fs O_SYNC throw
created: 2026-06-13
why: These node: builtin features throw NotImplementedError — a real runtime capability absence a consumer hits when running ordinary npm code; tracked here as the capability limitation itself, distinct from the compat-visibility item which only proposes ❌ matrix rows.
user_story: As a dev running an npm package that reaches `tls.createServer`, `dns.resolve`, `readline.createInterface`, `v8.serialize` or `dgram.createSocket`, I want it to run — but today these `node:` builtins throw `NotImplementedError` (honest loud stubs, parked by design).
sources: [ADR-0010, ARCHITECTURE.md]
code: [packages/runtime-js/src/builtins/tty.ts, packages/runtime-js/src/builtins/os.ts, packages/runtime-js/src/builtins/perf_hooks.ts, packages/runtime-js/src/builtins/vm.ts, packages/runtime-js/src/builtins/string_decoder.ts, packages/runtime-js/src/builtins/misc-stubs.ts, packages/runtime-js/src/builtins/null-net-stubs.ts, packages/runtime-js/src/builtins/crypto.ts, packages/runtime-js/src/builtins/fs.ts]
---

## Context

Confirmed throwing feature-ids (honest loud stubs per the no-silent-stubs rule): `crypto.Hash.copy`, `dgram.createSocket`, `fs.openSync.O_SYNC`, `os.setPriority`, `perf_hooks.monitorEventLoopDelay` + `perf_hooks.PerformanceObserver.observe`, `tls.createServer` (+ connect/Server/TLSSocket), `tty.ReadStream`/`tty.WriteStream`, `v8.getHeapStatistics`/`serialize`/`deserialize`, `vm.createContext.{name,origin,codeGeneration,microtaskMode}` / `vm.compileFunction.parsingContext` / `vm.context.var-pattern`; plus `dns.resolve*` (non-localhost — `lookup('localhost')` works, so dns is honestly a subset), `readline.*` (createInterface/cursorTo/…), and `string_decoder` non-utf8. These are not silent — they throw — but they are a genuine capability absence: an npm package that reaches any of them fails at runtime. This item records the absence as a tracked limitation; `process-meta/compat-matrix-coverage-debt` is the doc/compat-visibility half (publishing ❌ rows, no implementation). `zlib` is the one peer with its own dedicated impl item (`runtime-js/zlib-web-compression-subset`).

## Options or Next

Parked by design: "Full Node compat" and native modules are explicit non-goals (ARCHITECTURE.md). Default is to keep these as honest loud throws, not to build them. Promote a specific feature to its own active impl item only on concrete consumer demand — e.g. a target package needs `readline.Interface`, or in-browser TLS termination / DoH-backed `dns.resolve` (the network ones would need an ADR extending ADR-0010's loud-throw stance). Per feature, write a failing parity/ceiling case pinning the current throw shape first, then implement the subset. Keep the compat ❌ rows (`process-meta/compat-matrix-coverage-debt`) in sync so the public matrix matches these throws.

## Reversibility

REVERSIBLE to record the limitation and to keep the loud throws. Implementing any networked one (tls termination, dns over DoH) is IRREVERSIBLE — needs an ADR extending ADR-0010.
