# ADR 0424: Headless Pi agent over public project hosts

Status: Accepted
Date: 2026-09-12

## Context

PR #333's accepted goal needs one framework-free Pi loop over public Workbench
and no-COI hosts, consumer tools/transport, recovery and a comparable Pi CLI
bench. Replaces never-merged branch decision record 0190 from PR #111; no active decision
overturned. Host authority remains ADR-0263/0418.

Reference: `docs/backlog/distribution/reference/ai-agent-pi-pickup-evidence.md`;
executed Pi 0.85.1 Node/Chromium probes, upstream commit
`d981de1229ef899957bbe968bc8dcda02a21f477`. All seven scenarios pass in Node and
Chromium. Raw Pi leaves pending tool calls without results after Stop and does
not enforce its `replay` declaration.

## Decision

1. `@riftydev/agent` is a private workspace package above Workbench/SDK and below
   playground; no runtime package imports it. Pin Pi core/ai to 0.85.1. Publication
   remains separate. Export only `src/index.ts`.
2. Pi owns history, active-run cancellation and the loop. `send(prompt)` appends
   to its retained history, including after an error; no calls to raw
   `Agent.continue()` on an assistant error. Sequential tools share the existing
   host operation owner. No retry/replay ledger or parallel scheduler.
3. Public `AgentHost.capabilities()` supplies files, shell, optional preview,
   diagnostics/diff and prompt notes; read before every model turn. Consumers
   supply native Pi tools, instruction sections, `fetch` or full `streamFn`.
   Missing capabilities remove their tools and appear in the prompt. Workbench
   adapter accepts its real ProjectSession/terminal and optional companion;
   browser preview takes the actual host URL and optional iframe, never builds
   a port-derived URL. DOM actions fail loudly if the host document is inaccessible.
4. Default transport uses only `pi-ai/api/openai-completions`, zero automatic
   retries. Optional key: an internal SDK sentinel with `Authorization:null`
   when absent; wire probe proves no Authorization is sent. A provided key is
   memory-only; export removes it. `fetch`/streamFn own consumer auth and wire
   policy. No provider SDK or domain-action abstraction above these native seams.
5. Keep Pi's optional guarded `require('node:fs')` unchanged: native Chromium
   never enters the Bun-only branch; the no-shim browser probe passes. This
   corrects refine's static-import claim. No fake fs module or global process
   replacement. Heavy provider implementations are absent from the browser graph;
   unused genai/protobuf install scripts are explicitly disabled.
6. Host command abort calls the real stop and awaits settlement/slot release.
   Structured failed/cancelled outcomes survive via Pi's afterToolCall error flag.
   On settlement, each unexecuted member of an aborted tool batch receives an
   explicit error result in history/events before a later custom stream sees it.
   Already completed results are retained. The agent never retries an action
   automatically; the model's deliberate new request is not deduplicated by ID.
7. File tools use rooted paths; Workbench transforms retain read CAS versions.
   Host owns mutations; errors retain applied/unknown effects. Exact edits and
   unified patches never fuzz. Every text tool result, including extensions, is
   capped to 16 KiB UTF-8 head/tail with an omitted-byte marker. Per-run tool/time
   limits abort with distinct `budget-exceeded`; export carries events/history,
   command output, timings, usage and the available host's final diff.

## Mechanism sweep and alternatives

- `rg pendingToolCalls|toolResult|beforeToolCall|runTimeoutMs|maxToolCalls`
  across packages/apps/tools found no existing AI lifecycle owner. Use Pi's
  active run and transcript; only per-run limits and explicit missing-result
  completion are added, forced by I3/I4 and the executed Stop probe.
- Playground-only port: rejected by I1/I2, consumers must use Workbench directly.
- Handwritten loop: rejected by the accepted same-Pi premise and the real
  recovery probes; repeats an existing state owner without a forcing obligation.
- New correlation/replay cache: rejected; Pi's retained history plus public
  host settlement meets I3. Repeated model-issued IDs are not proof of replay.
- Browser process replacement/fs stub: rejected; native no-shim browser executes
  the same seven cases. An externalized optional require is not a browser fs API.

## Consequences

- Embedders own UI, permission/dependency policy, auth and domain tools.
- Workbench and SDK keep their distinct documented cwd/CAS/persistence behavior.
- Native Pi tools and model types are part of the agent interface; version is pinned.
