# Map — isolate-host-agent-tools

## Items

Seeded at FIT. Order: carrier (the User scenario over a real sandbox, texts asserted) → neutral
helpers moved below `@riftydev/agent` and the host → tools → packed-consumer import test.
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
- Where the neutral helpers live (a package both `@riftydev/agent` and `@riftydev/isolate-host`
  may import under `tools/checks/arch-rules.cjs`; isolate-host bundles its deps) — owner: agent —
  `pnpm check:arch`.

## Out of scope

- `shell` / command-line parsing (`exec` is one file path, ADR-0568 §1); `apply_patch`, `glob`,
  `grep`, diagnostics and preview tools of `@riftydev/agent`.
- `exec` options `env`, `cwd`, `stdin` (`NotImplementedError('isolate-host.sandbox-exec-<option>')`).
- A Pi adapter (the consumer runs its own loop).
