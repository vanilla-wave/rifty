---
area: runtime-js
status: draft
title: "In the isolate guest a runtime-internal use of a web global installed after the runtime loads gives the global's named gap or Node's result, never a leaked internal name or a wrong value"
created: 2026-11-24
why: runtime-js captures `URL`, `URLSearchParams`, `Blob`, `File`, `crypto.subtle` at module load, where the isolate guest has none yet (ceilings installed after); its internal uses then throw `URLConstructor is not a constructor`-style errors, and `url.parse`/`url.resolve` return wrong values silently
sources: [docs/backlog/runtime-js/isolate-require-esm-syntax-gaps.md, PR-440-review-rounds-2-3]
code: [packages/runtime-js/src/internal/posix-file-url.ts, packages/runtime-js/src/builtins/url.ts, packages/runtime-js/src/builtins/buffer.ts, packages/runtime-js/src/builtins/crypto.ts, packages/runtime-js/src/builtins/fs-path.ts, packages/runtime-js/src/module-loader/resolver.ts, packages/runtime-js/src/internal/create-require-path.ts, packages/isolate-guest/src/guest/web-shim.ts]
---

## Context

The isolate guest installs its ceiling globals (`web-shim.ts` `CEILING_GLOBALS`: `URL`,
`URLSearchParams`, `Blob`, `File`, …, and the `crypto.subtle` getter) after runtime-js loads, so the
runtime's load-time feature detection sees them absent. Every module-level capture of one is then
`undefined` (or a value read before the ceiling). Fault class `sibling-drift`: one runtime path
behaves per host on a host-provided global. Found while measuring unit
`runtime-js/isolate-require-esm-syntax-gaps` (PR #440) and its review rounds 2–3; absorbs the former
drafts `isolate-fs-path-url-instanceof` and `isolate-url-searchparams-export`.

Measured 2026-11-24, `sandbox.exec` of one CommonJS file over the same files, PR #440 at
`2c37d4597`'s runtime (equal to main for these paths), oracle Node v24.16.0:

| place | guest | Node |
|---|---|---|
| `resolver.ts` `fileUrlToVfsPath` (`new URLConstructor`), `import('file://<root>/m.mjs')` / `('…/c.cjs')` | `ModuleLoadError [UNSUPPORTED_PROTOCOL] Invalid file URL '…': URLConstructor is not a constructor` | namespace |
| `create-require-path.ts` (catch around `fileURLToPathPosix`), `createRequire('file://…')` | `TypeError [ERR_INVALID_ARG_VALUE]` "The argument filename must be a file URL object, …" | works |
| `posix-file-url.ts` `URLConstructor`, `url.pathToFileURL('/x')`, `url.fileURLToPath('file:///x')` | `TypeError: URLConstructor is not a constructor` | `file:///x`, `/x` |
| `url.ts` `export const URL`, `new (require('url').URL)('file:///x')` | `TypeError: url.URL is not a constructor` | works, `=== URL` |
| `url.ts:15` `URLSearchParams = globalThis.URLSearchParams`, `new (require('url').URLSearchParams)('a=1')` | `… is not a constructor` (`typeof` `undefined`) | works, `=== URLSearchParams` |
| `fs-path.ts:33` `p instanceof URLConstructor`, `fs.readFileSync({})` | `TypeError: Right-hand side of 'instanceof' is not an object` (browser hosts: code-less `fs path must be string, Buffer, or URL`, `runtime-js/fs-path-invalid-arg-type`) | `ERR_INVALID_ARG_TYPE` |
| `buffer.ts:42-43` `Blob: g.Blob, File: g.File`, `new (require('buffer').Blob)(['a'])`, `({}) instanceof require('buffer').File` | `… is not a constructor`; `Right-hand side of 'instanceof' is not an object` | `size` 1, `false`; `=== Blob` |
| `crypto.ts:504` `subtle: webcrypto?.subtle` (read before the ceiling getter), `require('crypto').subtle.digest` | `TypeError: Cannot read properties of undefined (reading 'digest')` | a function |
| `url.ts:76` `parse`, `:161` `resolve` (an empty `catch {}` around the `URL` use) — **wrong value, no error** | `url.resolve('https://example.com/a', 'b')` → `'b'`; `url.resolve('http://a.com/b/c', '../d')` → `'../d'`; `url.parse('http://u:p@a.com:8/b?c=d#e')` → `host` `'u:p@a.com:8'`, no `auth`/`hostname`/`port`/`path` keys (keys `protocol,slashes,host,pathname,search,query,hash,href`) | `'https://example.com/b'`; `'http://a.com/d'`; ``auth` `'u:p'`, `host` `'a.com:8'`, `hostname` `'a.com'`, `port` `'8'`, plus `path` |

Review round 3 also named, not measured here: `io/src/streams/from-web-validation.ts:33-40`,
`host-async-keepalive.ts:16`, `timers.ts:267`, `stream-web.ts:37-51` (`require('stream/web').ReadableStream
!== globalThis.ReadableStream`, a gap under another name); the bundle also carries `io`/`vfs`/
`kernel`/`net`, not swept.

Tried (PR #440 round 2) and taken out (round 3): one seam, `loadedGlobal(name)` — the capture when
the global exists at load, else a forwarder reaching `globalThis[name]` at use time, applied to
`URL` and `URLSearchParams`, plus rethrowing `NotImplementedError` in the two catches. It failed
because:
- `Reflect.construct(current, args, new.target)` gave instances the forwarder's prototype: after
  `require('core-js/actual')` installs a real `URL`, `pathToFileURL`/`fileURLToPath`/`new url.URL`/
  `new url.URLSearchParams` → `TypeError: Incorrect invocation`, `import('file:…c.cjs')` →
  `UNSUPPORTED_PROTOCOL … Incorrect invocation`;
- the runtime's internals then depend on what the guest puts in `globalThis.URL` (`delete
  globalThis.URL` → `undefined is not a constructor`; an arrow function → a throw in `instanceof`);
  a mutant without `Symbol.hasInstance` survived;
  (if this variant returns: the review's checked fix for the first point is
  `Reflect.construct(current(), args, new.target === forward ? current() : new.target)` — with it the
  whole core-js probe passes; the second and third points stand);
- its inventory (search `= globalThis.`) missed object literals (`buffer.ts`), reads before a getter
  (`crypto.ts`), silent `catch {}` (`url.ts`) and the other bundled packages.

## Question

How does the guest's runtime get the class right, provably complete? Candidates (review round 3):
- completeness by enumeration in the guest: every export of every builtin module one level deep,
  `typeof` (and identity with the global where Node has it) against live Node;
- a separate pass over every `catch` around a `URL` use (a gap must not become an invalid input or
  a wrong value);
- carrier, open: the host hands the runtime its ceiling globals at setup (as `declareNoEsmLoader`)
  instead of the runtime reading `globalThis` — or the ceilings installed before the runtime loads,
  at the cost of its load-time detection.

Owner: runtime-js with isolate-guest; user's call (manager decision, PR #440 round 3). Compat ❌
isolate-host.md rows "Web globals absent when the runtime loads", "`url.parse` / `url.resolve`".
