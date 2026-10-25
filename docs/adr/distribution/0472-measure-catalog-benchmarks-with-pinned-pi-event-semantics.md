# ADR 0472: Measure catalog benchmarks with pinned pi event semantics

Status: Accepted
Date: 2026-09-27

## Context

Goal agent-weak-models I12 measures the existing five tasks before mechanisms.
ADR-0434 still owns lanes/judges/privacy; ADR-0471 owns native model catalogs.

## Decision

- Benchmark endpoint is a native OpenAI Model entry plus thinking/temperature
  defaults and optional envKey. Context/output limits are explicit. Each lane
  receives the same entry; native models.json folds temperature into native
  samplingParams and uses the CLI thinking option.
- Add direct pi-ai 0.85.1 dependency to the private benchmark. Reuse its context
  overflow classifier; never duplicate provider error patterns or export a
  benchmark-only classifier through the public agent.
- Derive counts from observed final messages and retry/compaction events;
  native compaction summary usage is included. Keep raw agent status alongside
  the separate context-exceeded outcome. Judges, tasks and run count unchanged.
- API keys and model headers remain memory-only in native child environment/
  public header hooks; reports redact them and sensitive runs omit raw browser
  traces/screenshots, preserving ADR-0434 §4.

## Alternatives

- Copy pi overflow regexes: rejected; native classifier already owns provider semantics.
- Expand the public agent API for private report parsing: rejected; no runtime consumer needs it.
- Infer missing model windows for old configs: rejected by I1/I12; caller supplies limits.

## Evidence

`node /private/tmp/rifty-pr359-native-catalog-probe.mjs`: pi 0.85.1 ModelRuntime
loaded window 32768/output 4096, image input and compat from models.json;
wire carried max_completion_tokens 4096, reasoning_effort medium,
temperature 1 and top_p 0.95. Goal baseline records the real endpoint/run data.
