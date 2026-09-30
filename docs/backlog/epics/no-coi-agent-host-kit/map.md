# Map — no-coi-agent-host-kit

Remaining path: SDK lifecycle (items 1–2 together: I1 needs both native
contention and pre-ready progress), then agent install, then shared reference
host and whole-goal proof. PR #359 is merged. I4/I6/I7/I10 accepted; ledger
links the evidence. Quality measurement remains the following goal (PR #341).

## Items

1. `distribution/sdk-sandbox-lifecycle` — I1–I3; combined typed failures and
   boot/snapshot progress (former items 1–2). ADR-0486 fixes the carrier.
7. `distribution/no-coi-agent-reference-host` — **reference-host** — I8 and
   scenario 1–9; the packed lane's Vite consumer refactored into a
   connections-only `host.ts` (registry connected / none), SDK README links
   it, packed-consumer lane runs it, and `tools/agent-bench`'s no-COI lane
   boots the same module (user: measure what we ship). After 1–2 and 8; closes the goal.
8. `distribution/no-coi-agent-npm-install` — **agent-install** — I9; the
   agent's shell `npm install` over the existing installer; loud no-registry
   outcome; truthful prompt text. After 1.

## Open questions

- Reference-host proof checks text-only assistant tool_calls id/name/arguments and matching tool_call_id explicitly (text-content final review advisory; owner: agent).

- Agent install carrier: how the shell's `npm install` reaches the installer
  behind `toolchain.install` (same Worker, `installManifest`), how `<pkg>`
  arguments update `package.json`/lockfile before resolution, and how the
  operation joins the busy slot without a queue — owner: agent — item 8
  pickup; ADR citing ADR-0418 D4 there.
- No-registry outcome shape (typed identifier from item 1; message names the
  missing connection) and the conditional prompt text — owner: agent — item 8
  pickup.
- Registry connection location for I9 (sandbox-level option vs per-call
  `install({ registryUrl })`, `protocol.ts:90-98`; user words «к песочнице не
  подключен» point at sandbox level) — owner: agent — item 8's ADR; public API.
- Reference recipe after a new `snapshotId` when the agent added dependencies
  (scenario 4 × 6): `force` replaces `package.json`/lock/`node_modules`; the
  host reconciles (re-run install after apply vs manifest diff) — owner: agent
  — item 7 pickup; host policy under ADR-0417, never an SDK merge.
- Bench boots the host module (I8): today's lane differs in limits (40 calls /
  600 s, `tools/agent-bench/src/config.ts:60-61`) and provisioning
  (`toolchain.install` from `/npm-registry`, `no-coi-page.ts:37`) vs the kit's
  session defaults (100 calls / 600 s once agent-weak-models I9 lands; only
  `maxToolCalls` differs) and snapshot → `open`; which knobs become bench
  variables vs adopted host defaults — owner: agent — item 7 pickup; the cap
  question `distribution/agent-tool-text-cap-and-run-budgets-measure` stays
  separate.
- Bench import route: whether `tools/agent-bench` may import the reference
  host module from `tests/integration/fixtures/workbench-vite-consumer` under
  the arch/vitest wiring, or the module moves to a shared private location —
  owner: agent — item 7 pickup.

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
