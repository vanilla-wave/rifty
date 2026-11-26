# Map — isolate-host-agent-tools

## Items

1. `distribution/isolate-host-rejection-in-exit-listener-exits-0` — a rejection in an `'exit'`
   listener exits 1 as in Node (user 2026-11-25, F5); independent of the template goal, can run first.

Rest seeded at FIT. Order: carrier (the User scenario over a real sandbox, texts asserted) → neutral
core extracted from `@riftydev/agent` (Pi-free) → isolate-host adapter → packed-consumer import test.
`run_node`'s killed / `stateRefused` texts can be written now (killed run: rolled back, goal
Decisions 2026-11-25).

## Open questions

- The template has landed (PR #460: `createSandbox({ template })`, the mount `/node_modules`, hidden
  by `list_files`) — no longer a blocker. Left to this goal (user 2026-11-25, ADR-0568 Corrections):
  the template's package list (this goal reads it — from
  `/node_modules/*/package.json` or an API it adds) and `exec`'s changed paths
  (`distribution/isolate-host-exec-changed-paths`, this goal its trigger). `exec`'s `signal`
  for `execute(args, signal)`: landed, PR #431 (`AbortError` as Node; the state after an abort is
  the killed-run rule).
- The shared core package's name and layer (`tools/checks/arch-rules.cjs`; `@riftydev/agent` and the isolate-host adapter both import it) — owner: agent — `pnpm check:arch` at FIT.

## Out of scope

- `shell` / command-line parsing (`exec` is one file path, ADR-0568 §1); `apply_patch`, `glob`,
  `grep`, diagnostics and preview tools of `@riftydev/agent`.
- `exec` options `env`, `cwd`, `stdin` (`NotImplementedError('isolate-host.sandbox-exec-<option>')`).
- A Pi adapter (the consumer runs its own loop).
