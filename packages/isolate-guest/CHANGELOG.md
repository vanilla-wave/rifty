# @riftydev/isolate-guest

## Unreleased

- New package (ADR-0558), unstable: the V8-isolate guest bundle `@riftydev/isolate-guest/guest.js` (rifty `node -e` runtime + bare-V8 Web shim, moved from `@riftydev/isolate-host`), the bridge contract (`GuestHost`, `GuestEntry`), `createHostBridge` (validated host functions, `close()`), `exitStatus`, `IMPORT_GAP`, `UNCOPYABLE_REJECTION`. No dependencies. Tested with isolated-vm 7.0.2; 6.2.0 is a declared ceiling.
