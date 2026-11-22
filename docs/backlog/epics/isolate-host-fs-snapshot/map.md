# Map — isolate-host-fs-snapshot

## Items

None: the carrier and the codec landed on the goal branch (Final+GREEN PASS @ 6c765ddbe). Next: CLOSE, after the manager's external review (manager, 2026-11-22).

## Open questions

- Is a field-level `restoreStat` on vfs `MemoryFsSync` the smallest way to set `ino`/`ctime`/`birthtime` exactly (I1)? — owner: agent — Contract+RED of item 2, against the vfs owner README.
- Does the packaged `isolate-host` need the codec at runtime (today `@riftydev/isolate-guest` is its devDependency, bundled into the child only)? — owner: agent — the sandbox goal decides; noted to the manager 2026-11-22.

## Out of scope

- Sandbox API (`create(template, snapshot?)`, `snapshot()`, `destroy`), the rest-point rule, host file ops, the sandbox-level e2e, the per-call deadline around snapshot/restore, and the host → isolate copy of exactly the blob's range (ivm copies a view's whole backing store, probe P3) — sandbox goal (manager, 2026-11-22).
- Template layer (immutable `node_modules` asset) — its own goal; ADR-0567 §4 leaves the header field.
- Deltas, streaming, compression inside the isolate, process/heap/timer state.
- Symlinks, hard links, modes, owners: rifty's FS has none (ADR-0050); `fs.symlinkSync`/`chmodSync`/`linkSync` being absent functions is the runtime's gap, not this goal's.
