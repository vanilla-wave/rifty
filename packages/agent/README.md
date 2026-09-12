# Agent

Framework-free Pi coding agent over public rifty hosts. Private workspace
package; not published. ADR-0424. Runtime packages do not depend on it.

```ts
import { createAgentSession, createWorkbenchAgentHost } from '@riftydev/agent';

const agent = createAgentSession({
  host: createWorkbenchAgentHost({ session: projectSession }),
  settings: { baseUrl, model },
  instructions: ['Follow the project coding conventions.'],
  // tools: native Pi AgentTool[], fetch or full streamFn: consumer-owned.
});
const unsubscribe = agent.subscribe(renderEvent);
await agent.send('Inspect the project and fix the build.');
const trace = await agent.exportTrace();
await agent.dispose();
unsubscribe();
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

The default transport is OpenAI-compatible chat completions. `apiKey` is
optional and memory-only; absent means no Authorization header. Consumers own
auth, CSRF and request policy in their supplied fetch/streamFn. No key is saved
in the trace config; supplied key strings are redacted from exported values.

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
