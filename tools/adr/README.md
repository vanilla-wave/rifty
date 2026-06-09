# tools/adr

Scaffolds ADRs. Wired into root `package.json`:

- `pnpm adr:new <area> "Title"` — creates `docs/adr/<area>/NNNN-slug.md` from a template (validates `<area>`).

Without `--number`, the script reserves the next number from a machine-local counter
before writing. First run seeds that counter from the highest ADR on disk; later runs
use `max(machine counter, repo max) + 1`, so parallel agents on different worktrees
do not all pick the same `max+1`. The state lives in
`${XDG_STATE_HOME:-~/.local/state}/rifty/adr-number.json`; tests/tools can override
that directory with `RIFTY_ADR_STATE_DIR`.

Provisional / reversible decisions now live in `docs/backlog/` (lint via `pnpm backlog:check`); supersede an ADR by writing a new one (the old is removed + grafted — see [`docs/adr/README.md`](../../docs/adr/README.md) + ADR-0094).
