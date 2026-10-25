# Pi 0.85.1 browser + recovery probe — 2026-09-12

Read-only repo investigation for PR #333; disposable implementation only here.
No rifty package mocked, imported or implemented. Effects: real Node files and
real Chromium OPFS files. Only model/network replaced deterministically.

## Reproduction

Working directory: `/tmp/rifty-pi-probe-owRZdv` (same as `/private/tmp/...`).

```sh
npm install --registry=https://registry.npmjs.org --save-exact @earendil-works/pi-agent-core@0.85.1 @earendil-works/pi-ai@0.85.1 esbuild@0.25.0 playwright@1.58.2
node node-runner.mjs
node build-browser.mjs
node browser-runner.mjs
npm view --registry=https://registry.npmjs.org @earendil-works/pi-agent-core@0.85.1 version gitHead dist --json
```

Initial sandboxed npm install made no progress, interrupted; same command with
network escalation installed 103 packages in 9s. Browser runner requires local
HTTP listen and Chrome launch; run with sandbox escalation. Port random,
127.0.0.1 only. Server/browser closed after test. Parent-owned proxy untouched.

Versions: Node v24.16.0; Pi core/ai 0.85.1; esbuild 0.25.0; Playwright 1.58.2;
Chrome/Chromium 152.0.7977.84. Lockfile and `dependency-tree.json` retained.
Npm gitHead: `d981de1229ef899957bbe968bc8dcda02a21f477`.

Artifacts:

- `probe.js`: actual seven-case probe; assertions fail process/browser result.
- `node-runner.mjs`, `node-results.json`, `node-run.log`, `node-effects/*.txt`.
- `browser-entry.js`, `browser-runner.mjs`, `browser-results.json`, `browser-run.log`.
- `minimal.js`, `node-fs-browser.js`, `build-browser.mjs`, `*-meta.json`,
  `browser-build-results.jsonl`, compiled bundles.
- `npm-core-metadata.json`, `package-lock.json`, `install-escalated.log`.

## Browser strategy

Small exact consumer entry:

```js
import { Agent } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
export { Agent, Type, streamSimple };
```

Bundle these at producer package build, platform browser, format esm. Exact
esbuild resolution plugin `/^node:fs$/` resolves to the local browser module:

```js
export function readFileSync() {
  throw new Error('NotImplementedError(pi.provider-env.node:fs.readFileSync): unavailable in browser');
}
```

No `process` define/replacement, no consumer alias/config. Minimal bundle:
406108 bytes minified, 108881 gzip, 1020 metafile inputs, externals [], builtin
inputs []. This is a bundle feasibility proof, not a packed rifty consumer proof.

All seven behavioral cases PASS in each actual browser configuration:

| Bundle | Realm |
|---|---|
| esbuild default, no shim | native browser |
| exact node:fs shim | native browser |
| exact node:fs shim | consumer process polyfill `{env:{},versions:{}}` |
| exact node:fs shim | synthetic Bun-like polyfill `{env:{},versions:{bun:'probe'}}` |

Correction to old evidence: `provider-env.js:19` is an optional `require`
inside `try`, NOT a static ESM import. Default esbuild already bundles, leaving
one external require-call; native browser never reaches it. Shim removes even
that external. Heavy provider API implementations absent from this entry.

Honesty caveat: upstream catches failures from its optional Bun `/proc` fallback.
The shim itself throws; the entire Pi fallback does NOT propagate its error.
Bun-like process polyfill still works because Pi catches the absence of /proc.
Never describe this as a guaranteed propagated loud failure. No fake fs values
returned, and no actual browser filesystem behavior is approximated.

## Exact public APIs

Published file paths relative to this directory:

- `node_modules/@earendil-works/pi-agent-core/dist/agent.d.ts:9`:
  constructor `AgentOptions.streamFn` required.
- same `:39`: mutable instance field is `agent.streamFunction`, NOT `agent.streamFn`.
- `.../pi-agent-core/dist/types.d.ts:13`:
  `StreamFn = (model, context, options?) => AssistantMessageEventStream | Promise<...>`.
  Contract says request/model/runtime failures MUST use protocol final assistant
  `stopReason: 'error'|'aborted'` plus `errorMessage`, not throw/reject.
- `.../pi-ai/utils/event-stream` public export:
  `createAssistantMessageEventStream()`. Push `start` plus `done` (`message`) or
  `error` (`reason`, `error` assistant); `result()` resolves final assistant.
- `.../pi-agent-core/dist/types.d.ts:349`: tool
  `{ name, label, description, parameters: Type.Object(...), execute(id, args,
  signal?, onUpdate?), replay?, executionMode? }`.
- tool return `AgentToolResult<TDetails>` (`types.d.ts:317`):
  `{content: TextContent[]|ImageContent[], details: TDetails, usage?, terminate?}`.
  No `isError` field in the tool return contract.
- `state.systemPrompt`, `state.tools`, `state.messages` writable; arrays copied
  on assignment. Default batch execution is parallel; per-tool or Agent option
  can select sequential.
- `.../pi-ai/dist/types.d.ts:62`: provider options `fetch?: typeof globalThis.fetch`.
- Agent options do NOT directly have fetch; closure-wrap streamSimple below.
- `Agent.abort()` signals; `waitForIdle()` settles once the whole run/listeners do.

## Minimal default transport: optional key, injected fetch

Real OpenAI parser and SDK exercised with deterministic SSE/503 Responses:

```js
new Agent({
  initialState: { model, systemPrompt, tools },
  streamFn: (model, context, options) => streamSimple(model, context, {
    ...options,
    fetch: consumerFetch,
    apiKey: apiKey || 'unused-no-auth-sentinel',
    headers: apiKey ? headers : { ...headers, Authorization: null },
    maxRetries: 0,
  }),
});
```

`model` needs id/name/api:'openai-completions'/provider/baseUrl/reasoning/input/
cost/contextWindow/maxTokens. No model registry needed.
Sentinel only satisfies OpenAI SDK/Pi constructor; null header removes bearer
on wire. Probe proves all requests Authorization absent and X-CSRF-Token kept.
No supplied key/auth headers at all → `streamSimple` synchronously throws
`No API key for provider: probe` (`openai-completions.js:32-37,533-534`).
Thus a no-auth endpoint requires this explicit factory behavior. Consumers can
instead fully own authentication in injected fetch/custom StreamFn. `maxRetries:0`
used for deterministic failure proof; product retry policy separately decided.

## Behavioral results — Node and browser both PASS

1. `customPrompt`: tool performs one real write, next provider emits protocol
   error. State keeps user → assistant(toolUse) → toolResult(committed) →
   assistant(error). `agent.continue()` rejects before provider call with
   `Cannot continue from message role: assistant`. New `agent.prompt(...)`
   continues, custom provider sees completed result, write count stays one.
2. `customFollowUp`: identical failure; `agent.followUp(userMessage)` then
   `agent.continue()` works, keeps error/history, write count stays one.
   No history trimming needed for either public continuation route.
3. `openAIRecovery`: same action through real OpenAI adapter and mock fetch.
   First SSE requests tool, second request 503, new prompt triggers third
   request. Exactly three HTTP requests, one write, model wire contains the
   committed tool result. OpenAI serialization omits error assistant message.
4. `abortThrows`: exact Agent signal delivered to active tool; Stop observed.
   Throw becomes `toolResult.isError:true`, error text kept, details becomes {}.
   Sequential second tool never runs, has NO result in raw Agent history.
5. `abortStructured`: tool returns content+details
   `{outcome:'cancelled',worker:'replaced',effect:'unknown'}` and afterToolCall
   returns `{isError:true}`. Structured result survives history/events. New
   prompt uses fresh un-aborted signal. Same missing pending result as (4).
   Both (4)/(5) additionally run real OpenAI serialization: it inserts a tool
   result `No result provided` for pending call and omits aborted assistant.
6. `ignoresAbort`: tool ignores signal, Agent remains streaming after abort
   until tool promise resolves. Successful return then stays `isError:false`.
   Pi is not a cancellation watchdog; host adapter must call real host stop.
7. `replayDeclaration`: tool declared replay:'never'; model emits identical
   tool name/ID twice in separate completed turns. Pi Agent executes twice;
   real file has two lines. Field does not deduplicate this Agent path.

## Implications for core Contract+RED

- Define wrapper continuation without assuming raw Agent.continue works after
  assistant error/abort. Prompt/queued follow-up paths proven.
- Completed action history survives next-request failure. No generic transport
  abstraction is required; a public StreamFn/fetch seam suffices.
- Structured host cancelled/failed outcomes need afterToolCall mapping or an
  equivalent wrapper. Simply throwing discards structured details.
- Strict per-call partial outcome promise requires explicit treatment of
  skipped/unfinished tool calls in rifty history/events, including custom
  StreamFn. OpenAI's 'No result provided' synthesis is only provider formatting,
  not a raw transcript outcome or a rifty recovery guarantee.
- Model behavior/replay safety is not guaranteed by Pi replay:'never'.
- This probe does not prove Workbench terminal stop, worker replacement or
  versioned file writes. Those remain real rifty browser acceptance rows.

Primary upstream at published npm gitHead:

- https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/agent.ts
- https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/types.ts
- https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/agent-loop.ts
- https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/ai/src/api/openai-completions.ts
- https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/ai/src/utils/provider-env.ts
