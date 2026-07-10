---
area: playground
status: ready
title: Take the OPFS durability drain off the `npm install` exit path
created: 2026-07-10
why: install exit awaits drain→gate→stamp→drain (~490ms profiled 2026-07-05) before the prompt returns and vite starts; real npm exit does not fsync node_modules — durability can finish in background with stamp semantics intact
user_story: As a preset user, I want `vite` to start right after `npm install` finishes linking, but today install exit blocks on the full OPFS durability drain.
epic: install-tail-latency
blocked_by: []
sources: [docs/adr/playground/0187-install-stamp-durability-via-write-through-fifo-order-non-blocking-stamp.md]
code: [apps/playground/src/glue/npm-shell-command.ts]
---

## Context

`npm-shell-command.ts` awaits `stampInstalledTree` (drain → full-ledger gate →
stamp write → stamp drain, ADR-0187 Corrected) before the install command
resolves — so chained commands and the dev-server launch wait on OPFS
durability. Floor profiling attributed ~490ms of the install exit path to this
drain (client extraction itself is ~77ms, ADR-0195 context). Real Node parity:
`npm install` exit means the tree is in the FS namespace, not fsynced — the
durability tier is a browser-only concept, so backgrounding it is
fidelity-aligned, not a shortcut.

## Acceptance

- The install command resolves (prompt returns; a `&&`-chained command starts)
  after link/shims/lockfile, WITHOUT awaiting the durability sequence. The
  sequence itself runs unchanged in background: drain → full-ledger gate →
  stamp → stamp-drain, order preserved; only a clean drain stamps (ADR-0187
  Corrected semantics intact, not contradicted).
- Test with an injected slow flush: `install` resolves before the flush
  settles; the stamp lands only after the clean drain. RED-check: re-awaiting
  the sequence in the foreground fails the timing assertion.
- Dirty drain → stamp skipped + loud terminal warning (today's wording family),
  emitted asynchronously; test asserts the warning arrives without blocking
  install exit.
- Before/after of install→vite-ready measured (bench lane or e2e timing) and
  the delta recorded in the playground CHANGELOG; only the measured number is
  claimed.
- A second install/command mutating the same tree while the background sequence
  is in flight keeps FIFO ordering (stamp write lands before the later
  command's tree writes) — concurrency test.

## Parity cases

N/A — no Node-observable runtime change (programs inside the sandbox already
see the written VFS; the durability tier has no Node counterpart). The parity
statement IS the motivation: real `npm install` exit does not fsync the tree.

## Fault matrix

| Fault | Expected outcome | Proof |
|---|---|---|
| Tab/worker killed before background drain completes | no stamp persisted → next boot re-installs (self-heal); never a stamped-but-torn tree | kill mid-drain, assert no stamp on restore |
| Background drain reports dirty ledger (quota/perm) | stamp skipped + async terminal warning | unit with injected persist failure |
| Stamp write/drain itself fails after clean tree drain | warning, next boot re-installs (best-effort stamp, as today) | existing stamp-failure tests re-scoped to async path |
| Second install starts while first sequence in flight | FIFO keeps first stamp before second's tree writes; second's own stamp supersedes | concurrency test |
| Reload immediately after install exit | restore sees no stamp yet → re-install, no crash | e2e fast-reload assert |

## Out of scope

- Stamp format/keying changes; stamp invalidation at install start (separate
  item `playground/install-stamp-invalidation`).
- Backgrounding the lockfile/link/shim writes themselves — only the durability
  drain moves off the exit path.
- Memory-backend sessions (no durability tier) — behavior unchanged.

## Decisions

- REVERSIBLE: ordering and gate semantics of ADR-0187 Corrected are preserved;
  only the awaiting moves. CHANGELOG line at implementation, no ADR.
- The dirty-drain warning printing after the prompt has returned is accepted —
  honesty stays loud, latency does not pay for it.
