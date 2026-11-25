# Map — isolate-host-agent-tools

## Items

Seeded at FIT. Order: carrier (the User scenario over a real sandbox, texts asserted) → neutral
core extracted from `@riftydev/agent` (Pi-free) → isolate-host adapter → packed-consumer import test.
`run_node`'s killed / `stateRefused` texts can be written now; they are pinned at FIT to the
killed-run decision.

## Open questions

- Blocked on `epics/isolate-host-sandbox-template` (template package list, its mount for
  `list_files`, the changed-paths field) — owner: agent — settled when it lands. `exec`'s `signal`
  for `execute(args, signal)`: landed, PR #431 (`AbortError` as Node; the state after an abort is
  the killed-run rule).
- The shared core package's name and layer (`tools/checks/arch-rules.cjs`; `@riftydev/agent` and the isolate-host adapter both import it) — owner: agent — `pnpm check:arch` at FIT.

## Out of scope

- `shell` / command-line parsing (`exec` is one file path, ADR-0568 §1); `apply_patch`, `glob`,
  `grep`, diagnostics and preview tools of `@riftydev/agent`.
- `exec` options `env`, `cwd`, `stdin` (`NotImplementedError('isolate-host.sandbox-exec-<option>')`).
- A Pi adapter (the consumer runs its own loop).
