# tools/adr

Scaffolds ADRs. Wired into root `package.json`:

- `pnpm adr:new <area> "Title"` — creates `docs/adr/<area>/NNNN-slug.md` from a template (validates `<area>`).

Provisional / reversible decisions now live in `docs/backlog/` (lint via `pnpm backlog:check`); supersede an ADR by writing a new one (the old is removed + grafted — see [`docs/adr/README.md`](../../docs/adr/README.md) + ADR-0094).
