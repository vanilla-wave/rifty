# Map — isolate-host-fs-snapshot

## Items

None: the carrier and the codec landed (PR #418, main `11b9397ee`). Next: CLOSE, once the NUL/time residual below closes with PR #419.

## Open questions

- I1 «for any name rifty's FS holds»: until PR #419 lands, rifty's FS can hold names with NUL and times not finite or outside the Date range, which the codec refuses at snapshot (`ERR_FS_SNAPSHOT_UNREPRESENTABLE`) — owner: goal `isolate-host-live-sandbox` — closed by its PR #419 (`runtime-js/fs-path.ts` `nullCheck`, `builtins/fs-times.ts`: rifty stops holding both, I1 holds literally); manager, 2026-11-22.
- Does the packaged `isolate-host` need the codec at runtime (today `@riftydev/isolate-guest` is its devDependency, bundled into the child only)? — owner: agent — the sandbox goal decides; noted to the manager 2026-11-22.

## Out of scope

- Sandbox API (`create(template, snapshot?)`, `snapshot()`, `destroy`), the rest-point rule, host file ops, the sandbox-level e2e, the per-call deadline around snapshot/restore, and the host → isolate copy of exactly the blob's range (ivm copies a view's whole backing store, probe P3) — sandbox goal (manager, 2026-11-22).
- Template layer (immutable `node_modules` asset) — its own goal; ADR-0567 §4 leaves the header field.
- Deltas, streaming, compression inside the isolate, process/heap/timer state.
- Symlinks, hard links, modes, owners: rifty's FS has none (ADR-0050); `fs.symlinkSync`/`chmodSync`/`linkSync` being absent functions is the runtime's gap, not this goal's.
