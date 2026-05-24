# tools/adr

Scripts that scaffold and promote ADRs. Wired into root `package.json`:

- `pnpm adr:new "Title"` — creates `docs/adr/NNNN-slug.md` with a template.
- `pnpm adr:promote Q-YYYY-MM-DD-NNN` — promotes an entry from `OPEN_QUESTIONS.md` to a new ADR and clears `TODO(ADR): Q-...` markers in code.
- `pnpm todo:adr` — reports the count of `TODO(ADR):` markers across the repo.
