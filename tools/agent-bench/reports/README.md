# agent-bench reports

Every `pnpm agent-bench -- run …` invocation writes `reports/<run-id>/`:

- `report.json` — header (model, prompt profiles, task-set version, endpoint
  base URL + key ENV NAME, limits, lane versions) + per-run records with
  `failureClass: null` / `note: null` for HUMAN fill-in
  (classes: `agent / rifty-runtime / rifty-tooling / ai-mode-ux / provider / task-bad`).
- `summary.md` — human-readable rollup; regenerate after classifying with
  `pnpm agent-bench -- report reports/<run-id>`.
- `runs/<task>/<lane>/run-N/` — traces (pi event/session JSONL, dev-server and
  npm-install logs).

Everything here is gitignored except this README: traces contain model output
and are for local analysis; committed artifacts are human-authored summaries
only (ADR-0191). No secrets land here — the harness records only the env var
NAME of the API key, never its value.
