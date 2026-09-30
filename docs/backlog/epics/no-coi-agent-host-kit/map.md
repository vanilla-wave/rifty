# Map — no-coi-agent-host-kit

Live plan: index, not store. Minimal pattern first; each child a `draft`
finding compiled to `ready` at its own PICKUP (`RDY-1`). 1–4, 8, 9 are
independent except 8 after 1 (typed no-registry outcome); 5 is removed
(model selection is `epics/agent-weak-models`, PR #359); 6 after
agent-weak-models item 1 (the catalog entry it flags); 7 after all others and
after agent-weak-models item 1 (bench no-COI lane on the catalog) and closes
the goal. Goals run whole and in sequence: `epics/agent-weak-models` (PR
#359) → this goal → `epics/agent-code-quality-evaluation` (PR #341); the
per-item "after agent-weak-models item 1" notes follow from that. Cross-branch
order is text, not `blocked_by` (checker scope = one tree).

## Items

1. `distribution/sdk-typed-sandbox-outcomes` — **typed-outcomes** — I1 (typed
   occupied under either deadline), I2; exported identifiers + the README
   retryable table; the foundation every later child and the reference host
   discriminate on.
2. `distribution/sdk-boot-and-snapshot-progress-events` — **progress** — I1
   (waiting phase), I3; boot phases and apply counts on `runtime.on`.
3. `distribution/agent-transcript-model` — **transcript** — I7; framework-free
   reducer; playground chat consumes it (dogfood). Covers the chat events
   agent-weak-models (PR #359, lands before this goal) adds: model switch,
   compaction marker, retry attempts, steering message, `context-exceeded`.
5. removed 2026-09-27 (user «1 - a») — model selection and switching are
   `distribution/ai-agent-model-catalog` (agent-weak-models item 1, PR #359:
   catalog + `setModel`); I5 re-pointed there; no `settings`-form mechanism.
7. `distribution/no-coi-agent-reference-host` — **reference-host** — I8 and
   scenario 1–9; the packed lane's Vite consumer refactored into a
   connections-only `host.ts` (registry connected / none), SDK README links
   it, packed-consumer lane runs it, and `tools/agent-bench`'s no-COI lane
   boots the same module (user: measure what we ship). After 1–4, 6, 8, 9
   and agent-weak-models item 1 (PR #359: session from a one-entry catalog,
   bench lanes migrated); closes the goal.
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
- Shell tool text ordering carrier: rebuild text from the ordered `output`
  events vs an ordered capture in `SandboxCommandOutcome` — owner: agent —
  item 9 pickup; ADR-0436 D4 status header unchanged.
- Error identifier form: exported classes (need serialize/re-attach across the
  Worker hop, `errors.ts:217-277` precedent; fail under duplicated package
  copies) vs exported name constants + `isX(error)` predicates — owner: agent —
  item 1 pickup, REV-7 favours the lighter form; ADR at pickup (public API).
- Occupied under `startupTimeoutMs`: the host-side handshake timeout
  (`host.ts:433`) fires before the guard deadline under defaults; the
  discriminator must carry the contention observed by the Worker — owner:
  agent — item 1 pickup, with item 2's pre-`ready` phase post (feasibility of
  Worker-side posts before the handshake completes is unverified).
- Progress carrier: new `RuntimeEvent` kinds break consumers' exhaustive
  switches; alternative is one `progress` kind with a phase/count payload —
  owner: agent — item 2 pickup; ADR at pickup (public event union).
- Snapshot counts: whether the fetched archive declares a length (server
  `Content-Length`) and whether the dep-snapshot v3 payload exposes an entry
  total before extraction — owner: agent — probe at item 2 pickup; absent
  totals are reported as absent, never estimated.
- Text-only content carrier: pi-ai 0.85.1 `Model.compat`
  (`OpenAICompletionsCompat`) has no string-content flag; rifty-side message
  conversion before `streamSimple` vs an upstream compat flag — owner: agent —
  item 6 pickup. The flag lives on the catalog entry (user «2 - a»).

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
