# Map — isolate-host-agent-tools

## Items

Seeded at FIT. Order: carrier (the User scenario over a real sandbox, texts asserted) → neutral
core extracted from `@riftydev/agent` (Pi-free) → isolate-host adapter → packed-consumer import test.
`run_node`'s killed / `stateRefused` texts can be written now; they are pinned at FIT to the
killed-run decision.

## Open questions

- Blocked on `epics/isolate-host-sandbox-template` (template package list, its mount for
  `list_files`, the changed-paths field) and `distribution/isolate-host-sandbox-exec-abort-signal`
  (`execute(args, signal)`) — owner: agent — settled when those land.
- The killed-run text: «the writes of this run were rolled back» or «kept» — owner: user — asked in
  the template goal (one answer for both).
- «Ложный успех по коду выхода» (exit 0 where Node exits 1: GC-collected rejection, a rejection in an
  `'exit'` listener, the guest's replaced intrinsics): fix the cases, or the `run_node` description
  and the examples recommend `.catch(e => { console.error(e); process.exitCode = 1 })` and the host
  checks the expected output file — owner: user — asked 2026-11-24 with the template forks.
- The shared core package's name and layer (`tools/checks/arch-rules.cjs`; `@riftydev/agent` and the isolate-host adapter both import it) — owner: agent — `pnpm check:arch` at FIT.

## Out of scope

- `shell` / command-line parsing (`exec` is one file path, ADR-0568 §1); `apply_patch`, `glob`,
  `grep`, diagnostics and preview tools of `@riftydev/agent`.
- `exec` options `env`, `cwd`, `stdin` (`NotImplementedError('isolate-host.sandbox-exec-<option>')`).
- A Pi adapter (the consumer runs its own loop).
