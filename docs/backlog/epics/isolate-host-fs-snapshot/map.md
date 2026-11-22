# Map — isolate-host-fs-snapshot

## Items

None: the carrier and the codec landed on the goal branch (Final+GREEN PASS @ 6c765ddbe). Next: CLOSE, after the manager's external review (manager, 2026-11-22).

## Open questions

- I1 says «for any name rifty's FS holds» and the same `fs.statSync` after restore; the landed codec refuses at snapshot names over 16 383 code units or with NUL and times not finite or outside the Date range (`ERR_FS_SNAPSHOT_UNREPRESENTABLE`), and renews `ino` — narrow I1 to that, or require more? — owner: user — asked by the manager 2026-11-22; evidence: ADR-0567 §1, §6, compat rows (Final+GREEN probe: equal-length names over 16 383 units decode quadratically, 76 MiB in 22 s).
- Scenario step 2 says «identical to step 1», while `ino` is renewed (ADR-0567 §1) — accept «except `ino`»? — owner: user — asked by the manager 2026-11-22.
- Outcome says «never a partial tree»; a restore that runs out of memory while writing leaves a partial FS in an isolate that then refuses `run`/`snapshot`/`restore` (`ERR_FS_SNAPSHOT_INCOMPLETE`) — accept «all of the tree, or the isolate is thrown away»? — owner: user — asked by the manager 2026-11-22; evidence: acceptance `restore that runs out of memory while writing…`.
- Does the packaged `isolate-host` need the codec at runtime (today `@riftydev/isolate-guest` is its devDependency, bundled into the child only)? — owner: agent — the sandbox goal decides; noted to the manager 2026-11-22.

## Out of scope

- Sandbox API (`create(template, snapshot?)`, `snapshot()`, `destroy`), the rest-point rule, host file ops, the sandbox-level e2e, the per-call deadline around snapshot/restore, and the host → isolate copy of exactly the blob's range (ivm copies a view's whole backing store, probe P3) — sandbox goal (manager, 2026-11-22).
- Template layer (immutable `node_modules` asset) — its own goal; ADR-0567 §4 leaves the header field.
- Deltas, streaming, compression inside the isolate, process/heap/timer state.
- Symlinks, hard links, modes, owners: rifty's FS has none (ADR-0050); `fs.symlinkSync`/`chmodSync`/`linkSync` being absent functions is the runtime's gap, not this goal's.
