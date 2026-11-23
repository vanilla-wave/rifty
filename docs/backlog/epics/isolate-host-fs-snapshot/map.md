# Map — isolate-host-fs-snapshot

## Items

None: the carrier and the codec landed on the goal branch (Final+GREEN PASS @ 6c765ddbe). Next: CLOSE, after the manager's external review (manager, 2026-11-22).

## Open questions

- Outcome says «never a partial tree»; a restore that runs out of memory while writing leaves a partial FS in an isolate that then refuses `run`/`snapshot`/`restore` (`ERR_FS_SNAPSHOT_INCOMPLETE`) — accept «all of the tree, or the isolate is thrown away»? — owner: user — asked by the manager 2026-11-22; evidence: acceptance `restore that runs out of memory while writing…`.

## Closed elsewhere

- I1 «for any name rifty's FS holds» — closed 2026-11-23 by PR #419 (ADR-0568): rifty's FS no longer holds NUL names (`runtime-js/fs-path.ts`, Node's `nullCheck`) nor non-finite or out-of-Date times (`builtins/fs-times.ts`, utimes as Node 24.16.0).
- The packaged `isolate-host` carries the codec at runtime: bundled into `dist/codec.js` (`src/codec.ts`, ADR-0568 §2), no `@riftydev/*` dependency — decided by the sandbox goal (PR #419).

## Out of scope

- Sandbox API (`create(template, snapshot?)`, `snapshot()`, `destroy`), the rest-point rule, host file ops, the sandbox-level e2e, the per-call deadline around snapshot/restore, and the host → isolate copy of exactly the blob's range (ivm copies a view's whole backing store, probe P3) — sandbox goal (manager, 2026-11-22).
- Template layer (immutable `node_modules` asset) — its own goal; ADR-0567 §4 leaves the header field.
- Deltas, streaming, compression inside the isolate, process/heap/timer state.
- Symlinks, hard links, modes, owners: rifty's FS has none (ADR-0050); `fs.symlinkSync`/`chmodSync`/`linkSync` being absent functions is the runtime's gap, not this goal's.
