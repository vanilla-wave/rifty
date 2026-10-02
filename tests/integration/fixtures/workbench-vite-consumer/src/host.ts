import {
  type AgentRunLimits,
  type AgentSession,
  type AgentSessionOptions,
  type AgentTranscript,
  type OpenAIModel,
  type SandboxAgentHostOptions,
  createAgentSession,
  createAgentTranscript,
  createModels,
  createOpenAIProvider,
  createSandboxAgentHost,
  reduceAgentTranscript,
} from '@riftydev/agent';
import {
  type RuntimeEvent,
  type SandboxSnapshotSource,
  type ToolchainCreateSandboxOptions,
  createSandbox,
} from '@riftydev/sdk';
import { type SandboxSupportReport, checkSandboxSupport } from '@riftydev/workbench';

export interface HostConnections {
  readonly workerUrl: string;
  readonly probeBaseUrl: string;
  readonly storage: NonNullable<ToolchainCreateSandboxOptions['storage']>;
  readonly startupTimeoutMs?: number;
  readonly root: string;
  readonly registryUrl?: string;
  readonly provider: string;
  readonly models: readonly OpenAIModel[];
  readonly model: string;
  readonly apiKey?: string;
  readonly modelOptions?: AgentSessionOptions['modelOptions'];
  readonly policies?: SandboxAgentHostOptions['policies'];
  readonly limits?: AgentRunLimits;
  readonly mode?: SandboxAgentHostOptions['mode'];
  readonly renderSupport?: (report: SandboxSupportReport) => void;
  readonly renderRuntime?: (event: RuntimeEvent) => void;
  readonly renderTranscript?: (transcript: AgentTranscript) => void;
}

export interface HostPreparation {
  readonly snapshot?: SandboxSnapshotSource;
  /** Initial source files, written only when explicitly supplied. */
  readonly files?: Readonly<Record<string, string>>;
  readonly install?: { readonly registryUrl: string };
}

/** Private, copyable application composition; every behavioural owner is a library API. */
export async function openReferenceHost(connections: HostConnections) {
  const support = await checkSandboxSupport({
    probeBaseUrl: connections.probeBaseUrl,
    persistence: connections.storage.persistence,
    wasm: true,
  });
  connections.renderSupport?.(support);
  // Runtime has no SW; its disposable support-probe rows are informational here.
  if (support.modes.nonCoi.conclusion !== 'supported')
    throw new Error(`Sandbox prerequisites: ${support.modes.nonCoi.unmet.join(', ')}`);
  const opening = createSandbox({
    requireCrossOriginIsolation: false,
    skipServiceWorker: true,
    storage: connections.storage,
    startupTimeoutMs: connections.startupTimeoutMs,
    toolchain: { workerUrl: connections.workerUrl, registryUrl: connections.registryUrl },
  });
  const detachRuntime = opening.runtime.on((event) => connections.renderRuntime?.(event));
  const sandbox = await opening.catch((error: unknown) => {
    detachRuntime();
    throw error;
  });
  const models = createModels();
  let agent: AgentSession;
  try {
    models.setProvider(
      createOpenAIProvider({
        id: connections.provider,
        models: connections.models,
        apiKey: connections.apiKey,
      }),
    );
    agent = createAgentSession({
      host: createSandboxAgentHost({
        sandbox,
        project: { root: connections.root },
        policies: connections.policies,
        mode: connections.mode ?? (() => 'commands'),
      }),
      models,
      model: connections.model,
      modelOptions: connections.modelOptions,
      ...connections.limits,
    });
  } catch (error) {
    detachRuntime();
    sandbox.dispose();
    throw error;
  }
  const project = sandbox.project({ root: connections.root });
  let transcript = createAgentTranscript();
  const detachTranscript = agent.subscribe((event) => {
    transcript = reduceAgentTranscript(transcript, event);
    connections.renderTranscript?.(transcript);
  });
  // Only this host's calls queue. Agent calls still meet the SDK's busy admission.
  let pending: Promise<unknown> = Promise.resolve();
  function call<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation);
    pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  return {
    sandbox,
    project,
    agent,
    models,
    support,
    call,
    get transcript() {
      return transcript;
    },
    prepare(input: HostPreparation) {
      return call(async () => {
        if (input.snapshot)
          await sandbox.toolchain.applySnapshot({
            cwd: connections.root,
            snapshot: input.snapshot,
          });
        for (const [path, text] of Object.entries(input.files ?? {}))
          await project.fs.writeFile(path, text);
        if (input.install)
          await sandbox.toolchain.install({ cwd: connections.root, ...input.install });
      });
    },
    async downloadTrace() {
      const bytes = JSON.stringify(await agent.exportTrace(), null, 2);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'agent-trace.json';
      link.click();
      URL.revokeObjectURL(url);
    },
    async close() {
      try {
        await agent.dispose();
      } finally {
        detachTranscript();
        detachRuntime();
        sandbox.dispose();
      }
    },
  };
}

/** Display only. Never pass normalized output back to the agent. */
export function normalizeTerminalLines(text: string): string {
  const escape = String.fromCharCode(27);
  return text
    .replace(/\r\n/gu, '\n')
    .replaceAll('\r', '\n')
    .replace(new RegExp(`${escape}\\[(?:1)?G`, 'gu'), '\n')
    .replace(new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, 'gu'), '');
}
