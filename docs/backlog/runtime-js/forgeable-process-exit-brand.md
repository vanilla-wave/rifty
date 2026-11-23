---
area: runtime-js
status: draft
title: The RIFTY_PROCESS_EXIT brand is a plain property, so guest code can forge an exit
created: 2026-11-18
why: Every host realm recognises the runtime's exit signal by `code === 'RIFTY_PROCESS_EXIT'` on the thrown value, so guest code can throw a lookalike and choose its own exit status.
sources: [docs/public/compat/isolate-host.md]
code: [packages/runtime-js/src/builtins/process-lifecycle-events.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/kernel/src/worker-entry.ts]
---

## Context

Sandbox (ADR-0568): a member of the lifecycle class, compat ⚠️ (row "A run's lifecycle and exit status", measured in `reference/isolate-host-sandbox-lifecycle-class.md`). Owner: runtime-js. Trigger: the next change to the exit signal's brand, or a guest found forging it.

`isRiftyProcessExit` (`process-lifecycle-events.ts:50`) matches any value with
`code === 'RIFTY_PROCESS_EXIT'` and a numeric `exitCode`; the keepalive
(`handleRealmUncaughtError`) and the kernel worker entry use the same shape.
Measured in the isolate host (ADR-0557) @ 2cbb37c50:
`runCode("setTimeout(() => { throw { code: 'RIFTY_PROCESS_EXIT', exitCode: 0 } }, 1)")`
→ exit 0 with no diagnostic; `node -e` exits 1. The host's own tail now reads
the runtime's recorded terminal instead of the thrown value, so a top-level
forgery no longer works there, but a throw the *runtime* interprets still does.
Two more measured @ b9ff5be73: the signal object is mutable and catchable, so
`try { process.exit(3) } catch (e) { e.exitCode = 0 }` exits 0 (Node 3), and
`try { process.exit(3) } catch {}; console.log('after')` prints `after` where
Node prints nothing. `Object.freeze` on the signal in `#terminate` would close
the mutation half. Also @ 1d3fc3c43 (Node v24.16.0): `queueMicrotask(() => { throw { code: 'RIFTY_PROCESS_EXIT', exitCode: 0 } })`
→ exit 0, Node 1; and the brand check *reads* the thrown value, so
`throw new Proxy({}, { get() { throw new Error('trap') } })` runs the guest's
trap inside `isRiftyProcessExit` and stderr shows `Error: trap … at
isRiftyProcessExit (rifty-isolate-guest.js:…)` where Node prints no error text
(an empty line and the `--trace-uncaught` hint). Fix direction: a private brand (symbol or class identity) checked by the
runtime, so only the runtime's own signal counts. Browser kernel children share
the shape, so the same forgery should be probed there.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
