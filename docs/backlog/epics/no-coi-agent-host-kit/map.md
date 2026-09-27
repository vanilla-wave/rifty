# Map — no-coi-agent-host-kit

Live plan: index, not store. Minimal pattern first; each child a `draft`
finding compiled to `ready` at its own PICKUP (`RDY-1`). 1–6 are independent
except 6 after 5 (same transport file); 7 after 1–6 and closes the goal.

## Items

1. `distribution/sdk-typed-sandbox-outcomes` — **typed-outcomes** — I1 (typed
   occupied), I2; exported identifiers + the README retryable table; the
   foundation every later child and the reference host discriminate on.
2. `distribution/sdk-boot-and-snapshot-progress-events` — **progress** — I1
   (waiting phase), I3; boot phases and apply counts on `runtime.on`.
3. `distribution/agent-transcript-model` — **transcript** — I7; framework-free
   reducer, playground chat consumes it.
4. `distribution/agent-per-capability-project-policy` — **policy** — I4; one
   host, distinct files/shell policy over the SDK project policy.
5. `distribution/agent-per-turn-settings` — **per-turn** — I5; `settings` as a
   function resolved before each turn; ADR-0436 D2 correction (DEC-2).
6. `distribution/agent-text-only-content-transport` — **text-content** — I6;
   opt-in string-content mode; short ADR citing ADR-0436. After 5.
7. `distribution/no-coi-agent-reference-host` — **reference-host** — I8 and
   scenario 1–8; packed fixture promoted to a connections-only host, SDK README
   links it, packed-consumer lane runs it. After 1–6; closes the goal.

## Open questions

- Error identifier form: exported classes (need serialize/re-attach across the
  Worker hop, `errors.ts:217-277` precedent; fail under duplicated package
  copies) vs exported name constants + `isX(error)` predicates — owner: agent —
  item 1 pickup, REV-7 favours the lighter form; ADR at pickup (public API).
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
- Which `tools/agent-bench` lane the reference host must share its
  composition with (`lanes/rifty-no-coi.ts` today; `epics/agent-code-quality-
  evaluation` may re-cut lanes) — owner: agent — item 7 pickup, read the goal's
  current map.

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
- New `examples/` directory — carrier rejected (goal Decisions).
- A one-call composition entry — not seeded; re-chart if I8's host still
  carries mechanism after 1–6.
- Agent subagent orchestration, project resources (AGENTS.md/skills) —
  `distribution/ai-agent-subagent-orchestration`,
  `epics/agent-pi-project-resources`.
- Agent quality measurement itself — `epics/agent-code-quality-evaluation`;
  this goal only guarantees the host adds nothing quality-relevant.
