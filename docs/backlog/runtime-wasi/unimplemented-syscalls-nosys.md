---
area: runtime-wasi
status: parked
title: Remaining E_NOSYS preview1 syscalls (fd_allocate, fd_fdstat_set_rights, poll_oneoff, proc_raise, sock_*)
created: 2026-06-08
why: a band of preview1 syscalls are present-in-link-table but E_NOSYS; each is either platform-impossible or unneeded by current toolchain guests — documented-honest non-implementations
user_story: As a dev running a WASI guest that calls `poll_oneoff`, `sock_send`/`sock_recv`, `proc_raise`, `fd_allocate` or `fd_fdstat_set_rights`, I want those to work, but today each returns `E_NOSYS` (sockets/signals/poll are browser-impossible; `fd_allocate`/`fd_fdstat_set_rights` unwired pending a real guest need).
sources: [docs/public/compat/wasi.md]
---
## Context
Beyond the times-set (see filestat-set-times) and symlink (see vfs-symlinks) gaps, these return honest `E_NOSYS` in `packages/runtime-wasi/src/syscalls/`:
- `fd_allocate` — meaningless for in-memory backend
- `fd_fdstat_set_rights` — per-fd rights downgrade not modelled
- `poll_oneoff` — no in-browser fd-polling equivalent
- `proc_raise` — no signal infrastructure
- `sock_accept` / `sock_recv` / `sock_send` / `sock_shutdown` — no BSD sockets in browser
Every name is present as a function in the `wasi_snapshot_preview1` table (enforced by `wasi-link.test.ts`) so a real toolchain never `LinkError`s; only the *behaviour* is E_NOSYS.
## Options / Next
Mostly fundamental ceilings (sockets, signals, poll) — keep E_NOSYS, documented-final. `fd_allocate` / `fd_fdstat_set_rights` stay addressable only on verified guest need. Do NOT silent-stub (CLAUDE.md no-fake-values rule).
## Reversibility
Mixed: socket/signal/poll are IRREVERSIBLE non-goals (platform limits, stay E_NOSYS). `fd_allocate` / `fd_fdstat_set_rights` are local behaviour until a real guest need proves otherwise.
