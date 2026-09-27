# Weak-model baseline — preparation

Authority: agent-weak-models I12; ADR-0434/0471/0472. Model transport and UI
reuse independent Final+GREEN c5bb64273 / c288a9cc9. This unit changes private
measurement tooling, not runtime behavior (RDY-8).

`pnpm exec vitest run tools/agent-bench/src/catalog-metrics.test.ts`: 3/3 RED:
unknown native endpoint id; missing observed counters; missing context outcome.
Real Agent + MemoryVfs and pi serialization ran; only model network scripted.

`node /private/tmp/rifty-pr359-native-catalog-probe.mjs`, pi 0.85.1 public
ModelRuntime reading models.json: loaded contextWindow=32768/maxTokens=4096,
input=text+image, reasoning=true, compat.supportsReasoningEffort=true;
wire max_completion_tokens=4096/reasoning_effort=medium/temperature=1/top_p=.95.
The script remains under /private/tmp; native entry matches the catalog.

Proxy: temporary /private/tmp/rifty-pr359-codex-proxy.mjs, handler codexVersion
0.155.1, port 10539. Printed gpt-6-luna; actual chat request replied OK.
The home launcher has no CLI flag parser, so its original file was not changed.

Target measurement, not yet claimed: 42 runs, original five tasks, three cold
runs per supported lane; no mechanisms, no task/judge changes.

## Tooling verification

- Full `pnpm pr:check`: 25/25 PASS, including unit and parity; no isolated
  rerun. Log: /private/tmp/rifty-pr359-bench-pr-check.log.

- Config/metrics: 5/5 unit pass, using real Agent/MemoryVfs and native CLI
  AgentSession.compact. Summary usage and successful-compaction count observed.
- Cache-token RED: provider reports 10 prompt tokens, including 6 cached; pi
  exposes input=4/output=3/total=13. Initial report wrongly showed input=4.
  Normalized input now includes cacheRead/cacheWrite (browser total−output);
  same native parser test passes at input=10. Raw pi usage remains available.
- Live Luna protocol preflight (not one of the 42 measurements):
  /private/tmp/rifty-pr359-luna-agent-probe.mts; done, one real read_file, exact
  randomized package name returned, medium thinking, usage input1568/output46.
- Original three-lane smoke passed after full native endpoint migration;
  requests assert model/max tokens/temperature/top_p/reasoning for every lane,
  all 14 runs retain identical unchanged-task judge evidence and observed counters.
- Full private benchmark contract: 14/14 PASS (11.6m); all three lanes,
  budgets/deadlines, failure evidence, privacy, native isolation and context
  outcome. Additional model-header delivery/privacy: browser + native 2/2 PASS.
  Native extension/models.json never copy header secrets; real HTTP observer
  sees the header, redacted outputs and omitted sensitive browser tracing verified.
- PR-4: profile assertion accepts system OR developer role. Actual smoke traces
  at /private/var/folders/db/686y1tsx0cj84rn_2jmrf9680000gn/T/rifty-agent-bench-smoke-ktAzl0
  show developer role in all three lanes with reasoning=medium. Paragraph
  equality and every planted-defect/common-judge assertion remain unchanged.
- Native compaction summary test: real pi AgentSession.compact emitted its
  completed event; input/output counts equal the actual summary requests.

## Review discovery — credential serialization

Independent baseline_final_review: header `X-Version: "1"` made raw string
replacement corrupt JSON numbers; header `"` broke JSON syntax. Own sweep:
real Agent/native provider with header `X-Tag: error`, HTTP400, returned
`session.status()=error` but `exportTrace().status=[redacted]` and a masked
assistant stopReason. Existing I1/I12 violated; rifty-fix/RDY-8 repair.

Boundary: owned in-process projection, corrupt-input/provenance-lie. Siblings:
Agent exportTrace; benchmark report/trace/before/after; native JSONL events and
request/admission files. Transport loss/duplicate/reorder physically excluded
at this serialization boundary; no network recovery changed.

- Bench RED: 3 fail/1 pass, numeric/quote/protocol headers;
  /private/tmp/rifty-pr359-redaction-red.log.
- Product RED: four real Agent protocol collisions;
  /private/tmp/rifty-pr359-trace-redaction-red.log.
- Repair: stringify strings structurally; public protocol tags retain their
  meaning, explicit headers always mask values. Native metrics read raw events
  before export. Native extension embeds the same private benchmark serializer;
  Agent owns its public trace policy. One cross-boundary regression gate
  `tools/agent-bench/src/redaction.test.ts` covers both policies, without a
  benchmark-only public API or new runtime dependency.
- 10 focused tests pass; history/catalog/metrics suite also passed (45 before
  two extra privacy guards). Each bench/Agent tag/header guard was removed in
  isolation: all four mutants failed actual assertions; original files restored.
  Logs: /private/tmp/rifty-pr359-redaction-revert-{bench,agent}-{tags,headers}.log.
- Native emitted extension loaded by real Pi CLI with `X-Test: 1`; retry and
  compaction probes plus admission JSON passed. Source/output:
  /private/tmp/rifty-pr359-native-redaction-probe.{mjs,out}.
- Repair prepared in isolated /private/tmp/rifty-pr359-bench-repair while the
  42-run baseline continued on clean 0fab1a861; no measured mechanism changed.
  Full gate and browser/native protocol-header contract remain before review.
