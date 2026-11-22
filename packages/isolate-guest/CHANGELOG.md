# @riftydev/isolate-guest

## Unreleased

- `run()` settles for `process.exit(n)` or an uncaught throw from a microtask of the guest's synchronous run (exit n / 1); before it never settled. Guest stdout/stderr written after an `exit()` (or a completed fatal) is dropped, as Node prints nothing after it; at a natural exit what the `'exit'` listeners queue still prints, as in Node.
- Add optional `allowSharedArrayBuffer` on the pre-load `GuestHost` record. False removes the global for feature detection. Shared wasm backing buffers throw the named gap on access. Default true (ADR-0566).

- README: isolated-vm 7.0.2 loses an unhandled rejection a GC collects before its task ends (exit 0, no diagnostic; https://github.com/laverdet/isolated-vm/issues/589); without `onUnhandledRejection` the same loss makes the call settle normally instead of rejecting.
- Each host timer has its own slot (a stale delivery of a reused id touches nothing of the new timer); re-arm delays are whole ms rounded up (ADR-0558 Decisions 2026-11-19).
- `HostHooks.fire` returns a promise that settles once the guest ran the callback; a repeating timer re-arms only after it, so expiries no longer pile up in the embedder (memory and timer lag), and keeps Node's period from the tick's start. A hook returning no promise keeps the old unbounded re-arming. README example uses `Reference.apply` (ADR-0558 Decisions 2026-11-19).
- New package (ADR-0558), unstable: the V8-isolate guest bundle `@riftydev/isolate-guest/guest.js` (rifty `node -e` runtime + bare-V8 Web shim, moved from `@riftydev/isolate-host`), the bridge contract (`GuestHost`, `GuestEntry`), `createHostBridge` (validated host functions, `close()`), `exitStatus`, `IMPORT_GAP`, `UNCOPYABLE_REJECTION`. No dependencies. Tested with isolated-vm 7.0.2; 6.2.0 is a declared ceiling.
- The guest clock starts with each call: `createHostBridge` returns `timeOrigin` (its creation) and `now()` counts from it, so an in-process embedder's guests never read its uptime or link calls (cross-review 2026-11-18).
- Only the bridge's own refusals pass to the guest as is; a hook's `TypeError`, whatever its text, becomes `<name> failed`.
- README: the example refuses isolated-vm < 7, states that it has no limits (one guest line takes the service down; use `runCode` for untrusted code), and that the timer `fire` queue lives in the embedder's memory outside `memoryLimit`.
