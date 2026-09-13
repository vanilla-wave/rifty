# Bench pickup facts

Authority: goal I8 + distribution/agent-bench; exact five prompts on origin/ai-mode-mvp.
Current React tile: real-vite; template react-vite. Node control: hono-api.
No-COI excludes node-endpoint by accepted scope. Live runs = 15 COI + 15 CLI + 12 no-COI.

## Native Pi CLI 0.85.1

Installed probe graph: /tmp/pr333-pi-cli. Isolated PI_CODING_AGENT_DIR;
PI_OFFLINE=1, PI_TELEMETRY=0; --no-session --no-extensions --no-skills
--no-prompt-templates --no-themes --no-context-files. Explicit -e remains usable.

- /tmp/pr333-cli-noauth-probe.log: authHeader:false without apiKey exits1,
  zero requests. Synthetic sentinel admits the provider but still sends Bearer.
- /tmp/pr333-cli-public-extension.log, raw /tmp/pr333-cli-public-extension-4OyANq/result.json:
  public before_provider_headers with headers.Authorization=null yields two
  requests without Authorization. Native default tools: read/bash/edit/write.
- Same public extension tool_call hook admits one actual write, blocks the second
  with {block:true,terminate:true} and ctx.abort(). First file contains one;
  blocked file absent. No third HTTP request. CLI exits0; final native message
  is error/This operation was aborted. Therefore budget evidence must be explicit,
  never inferred from process exit code or tool_execution_start alone.
- before_agent_start supplies actual assembled systemPrompt/systemPromptOptions;
  captured in the same probe directory. Shared profile and host-context caveat
  must be explicit; quarry's pi-baseline vs pi-baseline+rifty-adapter names and
  claim that delta isolates environment are not proof of equivalence.

## Judges / preserved user prompts

- date-sort: five newest by parsed date, newest first; current data has nonpadded dates.
- search: title as typed, case-insensitive, result count updates.
- URL filters: status and assignee update URL and survive opening that URL.
  Native React label text is StatusAllopen… / AssigneeAllMara…; prefix label
  match is required, exact/word-boundary regex is wrong. Executed positive
  /tmp/pr333-ai-resume-judge.log and final live /tmp/pr333-ai-live.log.
- new-issue: New issue opener, empty title creates nothing AND tells required;
  valid title appears in list. No persistence on reload requested. Quarry judge
  omitted required-message check; filling every input is not a title contract.
- node-endpoint: /api/stats totals/byAuthor follow actual POSTed messages.

Same common judge file per task, canonical evidence excludes runtime URLs/timestamps.
Mock reads package.json then ends; planted defects remain. Smoke = all three
real lanes complete + byte-identical expected judge evidence, not invented solved tasks.
Real reports classify inspected failures manually and keep budget outcomes separate.

## Further accepted baseline measurement

I8 map already owns tsc --noEmit via .bin, vitest, and no-COI node -e/-p,
shell builtins, git and foreground pipes. UI live native diagnostics show
TS7016/7026 for React declarations; distinguish installed tree vs resolution
against native Node before assigning cause or a backlog residual.


## Source → consequence → authority

- I8 + raw user scenario4: preserve five prompts and 42 real runs; no-COI
  excludes node control by accepted user choice, not by a harness failure.
- Existing refinements explicitly reject environment-only attribution. Common
  policy paragraphs share one public agent getter; host facts differ and actual
  full prompts are retained. Default core prompt bytes are an acceptance target
  to preserve, not a fabricated pre-implementation measurement.
- Existing report workflow allows editing failureClass/note and regeneration;
  no separate classifier service/UI or automatic assignment is needed.
- Goal I4 + native executed budget probe: two common per-run limits; native
  exit0/error messages are not a budget detector. Per-tool timeout from the old
  quarry is not a goal promise and is not added to the core.
- SDK live install and project.fs.writeFile are public, already executed in
  tests/no-coi/no-coi-pi-agent.spec.ts. Packed lane can use these directly before
  the agent; no new snapshot producer or raw-fs fallback is required.
- Profile getter is a generic read-only policy surface, not a benchmark lane
  option in the core. Common instructions remain separate from host facts.
- Toolchain install/package APIs and local CLI source graph are test subjects;
  only external model/network faults may be scripted. The scaffold throws
  named NotImplementedError instead of manufacturing a report.


## Browser trace privacy oracle

`node /tmp/pr333-bench-trace-privacy.mjs` against local synthetic HTTP only:
Playwright1.60 trace with snapshots=true contains the actual Authorization key;
snapshots=false/sources=false retains native click actions but excludes the key.
Both requests really carried the synthetic header. A second probe logs a
provider error containing the key: snapshots=false also retains that console
text. Result `/tmp/pr333-bench-trace-privacy.json`. Therefore keyed runs omit raw
browser tracing/screenshots, explicitly retaining redacted textual evidence.
No-auth runs retain native action traces plus screenshots; tracing starts after
configuration. This avoids temporarily writing raw keyed traces to disk.


## Executed final preparation

- Pinned native CLI oracle now also starts a real Node program, aborts at1000ms
  through its public ctx.abort(), and verifies its recorded OS PID is gone.
  Tools case: first file retained, second absent,2 requests. Time case: active
  program stopped,1 request. Both native exit0; explicit budget marker retained.
  Command: node --import tsx reference/agent-bench-native-cli-oracle.mjs
  (repository-relative path); raw `/tmp/pr333-bench-native-oracle-final.log`,
  committed agent-bench-native-cli-result.json, temp roots named in that artifact.
- Agent public-index import works under native Node/tsx. Initial Playwright
  runtime import met its Babel declare-field limitation in io/Buffer before
  any test; infrastructure only. Metadata carrier now invokes the actual Node
  entry with tsx. Typecheck passes before RED.
- `/tmp/pr333-bench-contract-red-final.log`:11 intended failures at callable
  agent.prompt-profile / agent-bench.run NotImplementedError,0 timeouts.
  Carriers cover full14-run mock matrix, all-three call/time limits, retained
  provider-failure write, key-safe artifacts and invalid configuration.
- Default core system prompt frozen from this pre-refactor implementation,
  normalizing only the external date. packages/agent/src/prompt.test.ts protects
  the existing assembled policy while its public shared paragraphs are exposed.
  Model task outcomes/native positive judge controls and the full42 live matrix
  are still acceptance targets, not claimed pickup results.

## Contract review repair

Independent BLOCK62736497d: smoke accepted fabricated14 rows/phony traces with no lanes or judges
(`/tmp/pr333-bench-review-mutant.log`,2PASS). Raw `agent-bench-contract-red-f1.json` retained.
Carrier now owns the external HTTP observer:28 requests,14 actual package tool replies,
actual shared policy in provider messages. Every lane's real Playwright ZIP must carry
common-judge action calls inside its tracing group; no size-only proof.
Playwright1.60.0 native group probe: before Tracing.tracingGroup, Frame actions parentId,
after same callId (groupEnd emits no separate before). `/tmp/pr333-bench-trace-group.zip`.
Public policy additionally checked against actual core paragraphs; frozen baseline remains.
Strengthened RED:11 expected benchmark errors +1 profile RED, baseline1PASS; no import failure.
Final pass still executes native positive judge controls, full42 live matrix and baseline questions.
