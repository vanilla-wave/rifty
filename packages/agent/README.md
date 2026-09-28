# Agent

Framework-free Pi coding agent over public rifty hosts. Runtime packages do not
depend on it. ADR-0424/0436/0471.

```ts
import { createAgentSession, createWorkbenchAgentHost, createModels, createOpenAIProvider } from '@riftydev/agent';

const models = createModels();
models.setProvider(createOpenAIProvider({
  id: 'local', apiKey,
  models: [{
    id: model, name: model, provider: 'local', api: 'openai-completions', baseUrl,
    contextWindow: 128_000, maxTokens: 8192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }],
}));

const agent = createAgentSession({
  host: createWorkbenchAgentHost({ session: projectSession }),
  models, model,
  maxToolCalls: 100,
  runTimeoutMs: 600_000,
  instructions: ['Follow the project coding conventions.'],
  // tools: native Pi AgentTool[]; provider fetch is consumer-owned.
});
const unsubscribe = agent.subscribe(renderEvent);
await agent.send('Inspect the project and fix the build.');
const trace = await agent.exportTrace();
await agent.dispose();
unsubscribe();
```

The catalog is native pi `Models`: register providers with `setProvider` and
`createProvider`, or use the built-in `createOpenAIProvider`. The latter accepts
native OpenAI models (reasoning defaults false, input defaults ['text']); limits
are required. Custom providers own wire/auth and return native streams with real
response metadata. The old session-level settings/streamFn/fetch forms are removed.

`modelOptions: { [modelId]: { reasoning: 'medium', temperature: 1,
samplingParams: { top_p: 0.95 } } }` supplies pi request defaults. Thinking defaults
off; absent sampling fields use provider defaults. Native Model.samplingParams
also applies. `agent.setModel(id)` preserves history and affects the next request,
including during an active tool turn; missing or ambiguous ids throw. Subscribe
to `type: 'model'` for switches. No automatic fallback.

`send(prompt, images?)` accepts native pi ImageContent for entries whose input
includes image. Image-only prompts are allowed; a text-only entry rejects them
before a request, naming the model. Non-image binary data throws
`NotImplementedError('agent.prompt-binary-input')`; put those files in the
project and pass their paths. Playground's Attach files does that automatically
under /attachments, preserving existing files.

Restore a conversation by passing native Pi messages captured from `message_end`:

```ts
import type { AgentMessage } from '@riftydev/agent';

const history: AgentMessage[] = loadNativeMessages(); // host-owned storage/decoding
const agent = createAgentSession({ host, models, model, initialMessages: history });
agent.subscribe(event => {
  if (event.type === 'agent' && event.event.type === 'message_end') {
    history.push(event.event.message);
    saveNativeMessages(history);
  }
});
await agent.send('Continue from the saved work.');
```

`initialMessages` works with every catalog provider; creation copies history, so later
caller mutations cannot alter it. Supply native Pi 0.85.1 `user`, `assistant` and
`toolResult` messages with numeric timestamps and native content. Calls must have
matching id/name results in the immediately following tool-result group. Missing,
orphan, duplicate or mismatched results throw `TypeError` naming `initialMessages`
before host/model work. Required native fields (including assistant identity/usage,
content block payloads and tool-call arguments) are validated there too. A host-supplied paired `isError` result is accepted. Restored
tools never execute automatically. An `aborted/error` assistant containing tool calls
is incomplete and rejected even with paired results: Pi omits that proposal on wire.
Text-only aborted/error messages remain accepted. The host may change models for a new session;
Pi owns provider conversion. Storage, JSON decoding and migrations stay with the host.

`reset()` clears restored and new messages. Also clear the host's stored history on
conversation/project reset. `exportTrace().restoredMessageCount` counts originally admitted messages
until reset, independent of compaction; events, timings, aggregate usage and per-run limits describe
only new runs. Reset clears that count. Trace export redacts built-in keys and catalog headers;
persist native messages rather than the diagnostic trace when exact history matters.

The session owns its host handle. The Workbench adapter opens/closes one
dedicated terminal unless the caller supplies a terminal (caller-owned).
It never closes the ProjectSession. Attach the supplied terminal to the UI
to display agent commands/output beside user terminals.

For a no-COI `ToolchainSandbox` use `createSandboxAgentHost`:

```ts
import { createBrowserAgentPreview, createSandboxAgentHost } from '@riftydev/agent';

const host = createSandboxAgentHost({
  sandbox,
  project: { root: '/project', readonlyPaths: ['locked'], allowedCommands: ['npm', 'node'] },
  mode: () => mode, // host sets 'commands' or 'preview'
  preview: () => {
    const current = resident;
    return current
      ? createBrowserAgentPreview({ url: () => current.previewUrl, frame: () => iframe })
      : undefined;
  },
});
```

Host owns `startBin` and `await sandbox.stopResident()` plus its preview element.
Set preview mode after start; return to commands mode after exit. Preview mode
omits file/shell tools. No raw FS fallback, automatic mode switch or sandbox
disposal occurs in this adapter. SDK readonly/command policy stays authoritative;
root bounds standard file tools, not arbitrary guest code. Each command starts
with fresh cwd/env. File edits use ordinary read/transform/write without CAS;
forced Stop returns the SDK's unknown effects. Diagnostics/SCM are unavailable.

`send` continues retained history, including after errors. `stop` resolves after
the host command settles and the slot is reusable. `reset` requires an idle
session. Assistant retries follow the native Pi policy above; no approvals or
tool-action replay. Host failures retain their effects; skipped tool calls get
explicit non-execution results. Consumer tools must honor the abort signal; the
library cannot forcibly stop arbitrary consumer JavaScript.

`host.capabilities()` is read before each model turn. File/shell/preview and
diagnostic tools are offered only when provided. Optional Workbench companion:
`companion: workbench.playground.forSession(projectSession)`. Preview DOM uses
`createBrowserAgentPreview({url: () => preview.url, frame: () => iframe})`;
omitting `frame` offers fetch only. Inaccessible documents fail loudly.

The built-in provider uses OpenAI-compatible chat completions. `apiKey` is
optional and memory-only; absent means no Authorization header. Trace config
records the effective selected model, limits and request defaults; built-in keys
and catalog headers are redacted throughout export. Custom providers remain
responsible for private credentials they put in their returned messages.
Actual assistant model/provider/API metadata stays in the transcript.

Rifty-owned shell results begin with JSON status/exit/error/worker/effects;
preview fetch begins with HTTP status. The envelope is included inside the same
16 KiB text cap, so a following model turn can distinguish quiet outcomes.
Consumer tools must put their own model-relevant outcome in text.

Limits default to 100 tool calls / 600 seconds per `send`. Tool text results
use a 16 KiB UTF-8 head/tail cap. Trace includes native transcript, events and
agent output, timing, token usage and host diff (or explicit unavailability/error).
Storage remains host-owned. Multimodal/image tool results are unsupported and
throw `NotImplementedError('agent.tool-image-result')`.

| Capability | Support |
|---|---|
| UTF-8 edits and unified text patches, including Git-quoted paths | ✅ |
| Binary patches | ❌ `NotImplementedError('agent.apply_patch.binary')` |
| Image prompt input on image-capable models | ✅ |
| Non-image binary prompt input | ❌ `NotImplementedError('agent.prompt-binary-input')` |
| Image tool results | ❌ `NotImplementedError('agent.tool-image-result')` |

An aborted partial model proposal was never dispatched: it stays an aborted
assistant message. Only skipped calls from an accepted batch receive tool
results. Those results precede `agent_end`; its messages describe this run only.
The terminal status event is published after trace timings are complete.

Project resources load once at session creation (ADR-0440). `send` waits for
that read; file edits apply after `await agent.reload()`. Subscribe immediately
to receive the initial `resources` event; each reload returns/emits an
`AgentResourceReport` with context files, skills, diagnostics and unsupported
paths. Playground `/reload` shows this report without contacting the model.
Reset clears conversation only; reload preserves conversation.

The host root is cwd. The first root file among `AGENTS.override.md`,
`AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD` wins; no descendant context
scan. Skills follow pi 0.85.1 `.pi/skills` and `.agents/skills` discovery,
including ignore files, metadata diagnostics, collisions and hidden skills.
Profile/date → consumer `instructions` → project context → skills → cwd.

`contextFiles: false` and `skills: false` independently disable those blocks.
`userContextFiles: [{path, content}]` precedes project context;
`userSkills: [{name, description, filePath, disableModelInvocation?}]` occupies
pi's global skill slot, after project skills. Materialize supplied skills at
host-readable `filePath` locations; `read_file` loads their content. No home
scan. No-file hosts state that resources were not read; reload after returning
to file mode. Reload requires an idle live session; concurrent reload rejects.
A failed read fails the next run (`status`/`detail`); `reload()` retries it. The run time
limit also covers waiting for a pending read. `AgentFiles.list` entries carry
the listed directory joined with the name; other entries are reported and
skipped. Unreadable ignore files are skipped silently, as the CLI does.

After that read, `send` refuses loaded `/skill:<name>` and discovered
`/<template>` commands: `status: error`, `detail` names the unsupported command
(`NotImplementedError('agent.commandExpansion')`). No model request or history
entry is created; `send` retains its normal Promise settlement. Plain slash
text and unknown names still reach the model. Playground handles `/reload`
through `reload()`; direct `send('/reload')` follows template discovery.

| Pi resource | Support |
|---|---|
| Context files, skills, explicit reload | ✅ |
| `.pi/extensions` | ❌ reported unsupported |
| `.pi/prompts` (templates) | ❌ reported unsupported |
| `/skill:name` and `/name` expansion | ❌ templates discovered as the CLI does (`.pi/prompts/*.md`, ignore rules, no dotfiles) and reported, never loaded; playground chat refuses `/skill:<loaded skill>` and `/<reported template>`, forwards other `/`-text as pi does |
| `.pi/SYSTEM.md` | ❌ reported unsupported |
| `.pi/APPEND_SYSTEM.md` | ❌ reported unsupported |
| `.pi/settings.json` | ❌ reported unsupported |
| `.pi/npm` / packages / `pi install` | ❌ reported unsupported |


### Native continuation

Retry defaults: `{ enabled: true, maxRetries: 3, baseDelayMs: 2000 }`.
Compaction defaults: `{ enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 }`.
Pass partial `retry` / `compaction` options; `{ enabled: false }` disables each.
Transport retries remain zero; completed tools never replay. A model selection
made during backoff applies to the next request, including summary requests.

Compaction retains one native summary (with file-operation details) and recent
messages. This shape is accepted by `initialMessages`; malformed/non-leading
summaries reject before host work. Trace usage includes every current-session
request attempt, even failed/discarded responses and summaries; restored usage
is excluded. `reset()` clears current usage.

`retry` events expose attempt/delay; `compaction` events expose reason, outcome,
tokens before/after and whether the source was provider usage or an estimate.
Unrecovered native overflow ends `context-exceeded`; select a larger entry and
send another prompt to continue. No automatic fallback.


### Tool feedback

Built-in final results begin with a complete JSON budget receipt (`callsLeft`,
`msLeft`); body plus receipt stays within16KiB. Consumer plain text stays theirs;
existing shell/preview envelopes with matching details also receive counters.
Exact failed edits report counts/lines or a whitespace-insensitive hint; hints
never change matching. Third consecutive equal call/result queues native steering;
no deduplication. Sequence spans sends, reset clears it.

Successful writes/edits/patches append host diagnostics (up to10 entries). The
1000ms wait covers all changed files; delayed diagnostics are pending, missing or
rejected diagnostics are explicit unavailable. Mutation success/effects remain.

The shared v2 profile adds one workflow recipe. `recipe:false` omits only that
paragraph; `trace.config.recipe` records the effective setting.
