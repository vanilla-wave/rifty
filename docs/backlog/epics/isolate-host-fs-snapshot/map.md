# Map — isolate-host-fs-snapshot

## Items

1. `distribution/isolate-host-fs-snapshot-acceptance` — **acceptance carrier** —
   scenario steps 1–4 as one test file over the real guest bundle in real
   isolated-vm and in the Node realm, committed RED/expected-failure. No
   product capability by itself.
2. `distribution/isolate-host-fs-snapshot-codec` — format v1 codec
   (ADR-0567), FS adapter, `GuestEntry.snapshot`/`restore`, fault matrix,
   published cost (I1–I6). Hypothesis until the carrier hits it; expected the
   only wall.

## Open questions

- Is a field-level `restoreStat` on vfs `MemoryFsSync` the smallest way to set `ino`/`ctime`/`birthtime` exactly (I1)? — owner: agent — Contract+RED of item 2, against the vfs owner README.
- Does the packaged `isolate-host` need the codec at runtime (today `@riftydev/isolate-guest` is its devDependency, bundled into the child only)? — owner: agent — the sandbox goal decides; noted to the manager 2026-11-22.

## Out of scope

- Sandbox API (`create(template, snapshot?)`, `snapshot()`, `destroy`), the rest-point rule, host file ops, the sandbox-level e2e — sandbox goal (manager, 2026-11-22).
- Template layer (immutable `node_modules` asset) — its own goal; ADR-0567 §4 leaves the header field.
- Deltas, streaming, compression inside the isolate, process/heap/timer state.
- Symlinks, hard links, modes, owners: rifty's FS has none (ADR-0050); `fs.symlinkSync`/`chmodSync`/`linkSync` being absent functions is the runtime's gap, not this goal's.
