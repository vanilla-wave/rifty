# @riftydev/isolate-guest

## Unreleased

- New package (ADR-0558), unstable: the V8-isolate guest bundle `@riftydev/isolate-guest/guest.js` (rifty `node -e` runtime + bare-V8 Web shim, moved from `@riftydev/isolate-host`), the bridge contract (`GuestHost`, `GuestEntry`), `createHostBridge` (validated host functions, `close()`), `exitStatus`, `IMPORT_GAP`, `UNCOPYABLE_REJECTION`. No dependencies. Tested with isolated-vm 7.0.2; 6.2.0 is a declared ceiling.
- The guest clock starts with each call: `createHostBridge` returns `timeOrigin` (its creation) and `now()` counts from it, so an in-process embedder's guests never read its uptime or link calls (cross-review 2026-11-18).
- Only the bridge's own refusals pass to the guest as is; a hook's `TypeError`, whatever its text, becomes `<name> failed`.
- README: the example refuses isolated-vm < 7, states that it has no limits (one guest line takes the service down; use `runCode` for untrusted code), and that the timer `fire` queue lives in the embedder's memory outside `memoryLimit`.
