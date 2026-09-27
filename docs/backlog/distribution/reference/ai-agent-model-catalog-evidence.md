# Model catalog — preparation

2026-09-27; PR 359, goal agent-weak-models I1/I2; pi-ai/pi-agent-core 0.85.1.

## Baseline and RED

`pnpm exec vitest run packages/agent/src/session.test.ts packages/agent/src/history.test.ts`
→ 34/34 pass on the pre-implementation tree.

`pnpm exec vitest run packages/agent/src/catalog.test.ts`
→ 4/4 fail: catalog admission throws the old "Exactly one agent transport"
error; removed settings form still admits; built-in catalog provider absent.
No product implementation changed before this run.

## Native request probe

Executed `node --input-type=module` from repo root:

```js
import { streamSimple } from './packages/agent/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js';
const model = {
  id:'probe', name:'probe', api:'openai-completions', provider:'local',
  baseUrl:'https://probe.invalid/v1', reasoning:true, input:['text'],
  contextWindow:32768, maxTokens:4096,
  cost:{input:0,output:0,cacheRead:0,cacheWrite:0},
  compat:{supportsReasoningEffort:true},
};
for (const options of [{}, {reasoning:'medium',temperature:1,samplingParams:{top_p:.95}}]) {
  await streamSimple(model, {messages:[{role:'user',content:'hello',timestamp:0}]}, {
    ...options, apiKey:'probe-key', maxRetries:0,
    fetch:async (_url,init) => {
      const body=JSON.parse(init.body); delete body.messages;
      console.log(JSON.stringify(body));
      return new Response('data: [DONE]\n\n', {headers:{'content-type':'text/event-stream'}});
    },
  }).result();
}
```

```json
{"model":"probe","stream":true,"stream_options":{"include_usage":true},"store":false,"max_completion_tokens":4096}
{"model":"probe","stream":true,"stream_options":{"include_usage":true},"store":false,"max_completion_tokens":4096,"temperature":1,"reasoning_effort":"medium","top_p":0.95}
```

## Independent DEC-2 decision

Fresh read-only subagent `catalog_decision`, depth 1, 2026-09-27. Read raw
I1/I2, ADR-0424/0436 and installed pi. Recommendation: native Models and native
Provider; selected unique model id; pi request defaults keyed by id. Thin
OpenAI provider constructor only. ADR-0471 supersedes 0436 decisions 2–3.

Additional executed probes reported by that agent:

- Native AgentHarness + MemorySessionRepo: tool switches lane model; completed,
  request models `["one","two"]`, next history roles `["user","assistant","tool"]`.
- getAuth followed by streamSimple with explicit auth overrides resolves auth
  twice. Do not introduce a second credential resolution for trace redaction.
- Native simple stream sends Model.maxTokens; raw stream can omit it.
- `thinkingSignature: 'reasoning_content'` replays reasoning through a proxy;
  requiresReasoningContentOnAssistantMessages adds empty reasoning for text-only
  assistants. No URL heuristics need copying.

Source checks: Agent.createLoopConfig captures model; return model/thinking
from prepareNextTurnWithContext for active switching. Public compact exists;
compactWithRequest is not a public export. Native Harness remains a candidate
for mechanism slices after I12; this slice retains the existing Agent owner.

## IMPLEMENT verification

- `pnpm exec vitest run packages/agent/src tools/agent-bench/src/project-resources.test.ts`: 114/114 pass.
- `pnpm typecheck`: all workspace packages pass after fixing the fixture's Provider type import.
- First `pnpm pr:check`: 24/25; typecheck captured the missing import before its repair.
  test:run's one session test passed its automatic isolated rerun (0 timeouts);
  the test observed an in-flight repair of custom transport classification.
  A clean full gate follows; this run is not final evidence.
- Custom provider trace regression: retained existing custom-transport assertion
  failed (`openai-compatible` vs `custom`); classification now uses provider
  provenance, not selected model API. Isolated session tests: 6/6 pass.
- `RIFTY_PLAYGROUND_PORT=5399 pnpm exec playwright test --config playwright.browser-unit.config.ts tests/browser-unit/agent-core.spec.ts`: 17/17 pass.
- `RIFTY_PLAYGROUND_PORT=5398 pnpm exec playwright test --project=chromium-heavy --workers=1 tests/e2e/ai-mode.spec.ts`: 12/12 pass.
- Contract review concerns: header-secret echo added and passes; third request
  model checked; ADR baseline-order wording clarified (images may precede I12).
- Snapshot browser proof: 1/1 pass; no-COI agent suite: 5/5 pass.
- `pnpm test:packed-consumer`: first run reproduced TS5097 on two new local
  `.ts` imports. Removed their extensions to match the consumer's existing
  imports (tsconfig unchanged). Full rerun passes: real tarballs, typecheck,
  installed agent, Vite preview/HMR and fresh Chromium.
- Final clean-tree `pnpm pr:check`: 25/25 pass; test:run passed directly (191.6s),
  no isolated rerun. Full parity lane passed.
- `pnpm agent-bench run --mock-model --runs 1 --output /private/tmp/rifty-pr359-catalog-smoke`: 14/14 runs, all three lanes, every agentStatus=done/toolCalls=1, no setup/judge exceptions. All 14 task judges fail as intended for the read-package-only smoke. Own fresh playground server recorded in output/playground.log.
