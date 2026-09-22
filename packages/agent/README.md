# Agent

Framework-free Pi coding agent over public rifty hosts. Runtime packages do not
depend on it. ADR-0424/0436.

```ts
import { createAgentSession, createWorkbenchAgentHost } from '@riftydev/agent';

const agent = createAgentSession({
  host: createWorkbenchAgentHost({ session: projectSession }),
  settings: { baseUrl, model },
  maxToolCalls: 100,
  runTimeoutMs: 180_000,
  instructions: ['Follow the project coding conventions.'],
  // tools: native Pi AgentTool[]; fetch is consumer-owned.
});
const unsubscribe = agent.subscribe(renderEvent);
await agent.send('Inspect the project and fix the build.');
const trace = await agent.exportTrace();
await agent.dispose();
unsubscribe();
```

For a consumer-owned model/wire/auth path, pass Pi's native `StreamFn` without
OpenAI-compatible settings. It receives the current system prompt, messages,
tools and request `AbortSignal`; close over the actual model/transport and return
an `AssistantMessageEventStream` carrying its real response metadata.

```ts
const agent = createAgentSession({
  host,
  streamFn: (_unusedModel, context, options) =>
    streamThroughConsumerModel(context, { signal: options?.signal }),
  tools: domainTools,
});
```

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
session. No automatic retries, approvals or action replay. Host failures retain
their effects; skipped tool calls get explicit non-execution results. Consumer
tools must honor the abort signal; the library cannot forcibly stop arbitrary
consumer JavaScript.

`host.capabilities()` is read before each model turn. File/shell/preview and
diagnostic tools are offered only when provided. Optional Workbench companion:
`companion: workbench.playground.forSession(projectSession)`. Preview DOM uses
`createBrowserAgentPreview({url: () => preview.url, frame: () => iframe})`;
omitting `frame` offers fetch only. Inaccessible documents fail loudly.

The settings transport is OpenAI-compatible chat completions. `apiKey` is
optional and memory-only; absent means no Authorization header. Consumers own
auth and request policy in their supplied fetch or full `streamFn`. No key is
saved in trace config; supplied settings-key strings are redacted from exported
values. Custom trace config identifies custom transport; actual model/provider/API
metadata comes from retained assistant messages.

Rifty-owned shell results begin with JSON status/exit/error/worker/effects;
preview fetch begins with HTTP status. The envelope is included inside the same
16 KiB text cap, so a following model turn can distinguish quiet outcomes.
Consumer tools must put their own model-relevant outcome in text.

Limits default to 100 tool calls / 180 seconds per `send`. Tool text results
use a 16 KiB UTF-8 head/tail cap. Trace includes native transcript, events and
agent output, timing, token usage and host diff (or explicit unavailability/error).
Chat persistence and multimodal/image tool results are unsupported; the latter
throws `NotImplementedError('agent.tool-image-result')`.

| Capability | Support |
|---|---|
| UTF-8 edits and unified text patches, including Git-quoted paths | ✅ |
| Binary patches | ❌ `NotImplementedError('agent.apply_patch.binary')` |
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
