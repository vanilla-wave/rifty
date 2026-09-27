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

## Observation before privacy

Reviewer extended the root-class sweep: header `edit_file` erased tool identity;
`Validation failed for tool ` erased malformed-call recognition; `Operation
aborted` hid the blocked proposal exclusion. A context-error keyword had the
same lossy projection. `metrics-privacy.test.ts`: four real Agent/MemoryVfs REDs
(/private/tmp/rifty-pr359-metrics-privacy-red.log), then GREEN.

Browser lanes now collect final message/continuation events through existing
AgentSession.subscribe, before privacy; COI exposes only a private opt-in hook
delegate. The benchmark computes counters/call admission from these observations;
raw events stay in memory, exported artifacts remain redacted. No public core
API, second runtime history, classifier copy or extra string exception list.
Native events already use the same pre-privacy boundary. Both original and
new collector reproduce all10 metrics on all42 recorded runs exactly.

## Recorded baseline

`pnpm agent-bench run --config tools/agent-bench/configs/gpt-6-luna.json
--output tools/agent-bench/reports/2026-09-27-luna-baseline`: exit0, 42 runs,
40 pass. Source0fab1a861 clean; original output subsequently moved intact to
/private/tmp/rifty-pr359-luna-baseline (raw generated files are not lint inputs).
Committed summary: tools/agent-bench/reports/summaries/2026-09-27-gpt-6-luna-baseline.
All42 source records roundtrip; gzip3158803 bytes, SHA256
8e82df4ea1f13d20b4c2316c4c2bf4928ba9d7d4efc4085a2aced84ea7698ebe.

Two `agent` failures, no replacement runs: URL no-COI3 removed useState import
(original browser pageError); native Node2 claimed work after only read/ls,
no changed bytes and real stats endpoint404. Per-lane15/15,11/12,14/15.
No budget/context failures;13 rejected patch formats recovered. Config, task
set and original measurements preserved for I13.

CI on0fab1a861: all except browser-unit passed; sandbox-support repeated-call
case reported page/context/browser closed. The exact case reran independently
and passed (1/1,4.3s), no source repair; log
/private/tmp/rifty-pr359-browser-ci-isolated.log. Final CI remains required.

## Final privacy/provenance verification

Full `pnpm pr:check` on5fa57bc9:25/25 PASS, no isolated retries
(/private/tmp/rifty-pr359-baseline-pr-check-green.log). Independent reviewer:
51 unit PASS; all209 raw artifact hashes,42 records,308 actual Luna requests,
token totals/classes and replay-source hashes verified.

Focused acceptance: three-lane14-pair smoke, all three budget admissions and
all three raw tool/context privacy cases PASS. Numeric-header cases exposed
masked artifact links and revision/profile; FileTree probe exposed an unmasked
credential filename. Same observed class, so ownership changed rather than
adding more word exceptions: typed report retains generated provenance,
addresses and judge/diff structure; only caller/project payload is private.
Protocol frames preserve tags; opaque payload masks string values AND dictionary
keys, including JSON-escaped text. Ordinary tool metadata stays intact.

- Metadata/path RED: /private/tmp/rifty-pr359-baseline-acceptance.log (9PASS/2RED);
  /private/tmp/rifty-pr359-private-path-red.log (real write, snapshot-key leak).
- Three payload/ordinary-header REDs: /private/tmp/rifty-pr359-payload-privacy-red.log.
- GREEN:21 unit (/private/tmp/rifty-pr359-payload-privacy-green.log), typecheck;
  five real browser/native privacy cases, including unchanged numeric-header
  checks and the credential-named write
  (/private/tmp/rifty-pr359-report-payload-acceptance.log):5/5 PASS,1.7m.
- Earlier14 baseline contracts and2 opaque-header checks passed before the
  repairs; unchanged judge/isolation/deadline cases were not redefined.
  New final source gate and independent verify remain before I12 closure.
