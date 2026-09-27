# Map — no-coi-agent-host-kit

Live plan: index, not store. Minimal pattern first; each child a `draft`
finding compiled to `ready` at its own PICKUP (`RDY-1`). 1–6 are independent
except 6 after 5 (same transport file); 7 after 1–6 and closes the goal.

## Items

1. `distribution/sdk-typed-sandbox-outcomes` — **typed-outcomes** — I1 (typed
   occupied under either deadline), I2; exported identifiers + the README
   retryable table; the foundation every later child and the reference host
   discriminate on.
2. `distribution/sdk-boot-and-snapshot-progress-events` — **progress** — I1
   (waiting phase), I3; boot phases and apply counts on `runtime.on`.
3. `distribution/agent-transcript-model` — **transcript** — I7; framework-free
   reducer; playground chat consumes it (dogfood).
4. `distribution/agent-per-capability-project-policy` — **policy** — I4; one
   host, distinct files/shell policy values over the SDK project policy.
5. `distribution/agent-per-turn-settings` — **per-turn** — I5; `settings` as a
   function resolved before each turn; superseding ADR + ADR-0436 §Corrections.
6. `distribution/agent-text-only-content-transport` — **text-content** — I6;
   opt-in string-content mode; short ADR citing ADR-0436. After 5.
7. `distribution/no-coi-agent-reference-host` — **reference-host** — I8 and
   scenario 1–8; the packed lane's Vite consumer refactored into a
   connections-only `host.ts`, SDK README links it, packed-consumer lane runs
   it. After 1–6; closes the goal. Scope of the bench relation waits on the
   open user question below.

## Open questions

- Must rifty's benchmark run the reference host's configuration (read-only
  shell, per-turn settings, text-only content) rather than only share entry
  points? — owner: user — asked 2026-09-27 (goal Decisions, critic-2 P1);
  answer (a) adds "bench lane boots the reference host module" to item 7,
  answer (b) records an explicit scope reduction; goal stays draft until then.
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
  item 6 pickup.

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
  carries mechanism after 1–6.
- Other OpenAI-compatible endpoint quirks (fixed `Model` fields: context
  window, max tokens, reasoning, `compat`) — stay on the `streamFn` form
  (ADR-0436); only string content is claimed (I6).
- Agent subagent orchestration, project resources (AGENTS.md/skills) —
  `distribution/ai-agent-subagent-orchestration`,
  `epics/agent-pi-project-resources`.
- Agent quality measurement itself — `tools/agent-bench` /
  `epics/agent-code-quality-evaluation` (PR #341); this goal guarantees the
  host adds nothing quality-relevant.
