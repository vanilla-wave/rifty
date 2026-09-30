# Map — no-coi-agent-host-kit

All I1–I10 accepted; I5 in merged PR #359. Independent whole-goal CLOSE
PASS at2534d1e97ef838c07c0c4caa6c464877347dc7a4. Ledger links proof.

## Items

None.

## Open questions

None.

## Out of scope

- Preview / visual debugging of the running app — user 2026-09-27: separate
  epic; draft `epics/no-coi-visual-debug`; baseline `startBin` previewUrl
  (ADR-0377), `distribution/public-api-ai-agent-preview-question`.
- UI component for the chat — `distribution/ai-ide-product-ui` (M12); this
  goal ships the headless transcript model only.
- Fast second-opener rejection / namespace-keyed lease — declined 2026-09-27.
- SDK-held applied-snapshot identity, `ensureSnapshot`, producer metadata
  sidecar — declined 2026-09-27 (user: no identity check).
- Legacy OPFS layout migration or read path — declined 2026-09-27 (0.x).
- Serialising `run()`/fs, FIFO — ADR-0376, declined rows.
- Published conformance / test-fixture package — declined 2026-09-17.
- `page-locks` required for the sdk-toolchain mode — ADR-0437/0438.
- ANSI/line/severity helpers, `downloadTrace()` as package exports — declined
  2026-09-17; host code in the reference host.
- New `examples/` directory; the surface-only packed fixture as the host base
  — carriers rejected (goal Decisions).
- A one-call composition entry — not seeded; re-chart if I8's host still
  carries mechanism after 1–6, 8, 9.
- 16 KiB tool-text cap (ADR-0424 D7) — measured first:
  `distribution/agent-tool-text-cap-and-run-budgets-measure` (no owning
  goal); run budgets are `epics/agent-weak-models` I9 (100 calls / 600 s,
  user «3 - a»); the kit changes neither.
- Command fidelity outside the kit (agent adapter and SDK commands): empty `process.env` + npm lifecycle
  vars, `spawn('npm'|'.bin/*')` ENOENT, `node -p`/`--input-type` on no-COI,
  `npx` nudge — finding drafts `distribution/no-coi-command-env-and-npm-
  lifecycle-vars`, `runtime-js/child-process-spawn-npm-and-bin-via-shell`,
  `distribution/no-coi-node-print-and-input-type-flags`,
  `shell/npx-and-package-manager-nudge-honesty`.
- `npx`, `yarn`, `pnpm`, postinstall scripts (`npm-client/postinstall-scripts`)
  — not claimed by I9; loud today.
- Other OpenAI-compatible endpoint quirks (context window, max tokens,
  reasoning, `compat`) — per-entry fields of the agent-weak-models catalog
  (PR #359); this goal claims only the text-only flag (I6).
- Model selection / switching API — `epics/agent-weak-models` (catalog +
  `setModel`); the per-turn `settings` item was removed 2026-09-27 («1 - a»).
- Agent subagent orchestration, project resources (AGENTS.md/skills) —
  `distribution/ai-agent-subagent-orchestration`,
  `epics/agent-pi-project-resources`.
- Agent quality measurement itself — `tools/agent-bench` /
  `epics/agent-code-quality-evaluation` (PR #341); this goal guarantees the
  host adds nothing quality-relevant.
