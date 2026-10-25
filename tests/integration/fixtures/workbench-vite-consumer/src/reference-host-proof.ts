import { type AgentTranscript, type OpenAIModel, createOpenAIProvider } from '@riftydev/agent';
import { type RuntimeEvent, type SandboxSnapshotSource, sandboxErrorKind } from '@riftydev/sdk';
import { type HostConnections, normalizeTerminalLines, openReferenceHost } from './host';

let host: Awaited<ReturnType<typeof openReferenceHost>>;
let connections: HostConnections;
let runtime: RuntimeEvent[] = [];
let rendered: AgentTranscript[] = [];
const view = document.createElement('pre');
view.id = 'transcript';
const progressView = document.createElement('pre');
progressView.id = 'runtime-progress';
const supportView = document.createElement('pre');
supportView.id = 'support';
document.body.append(supportView, progressView, view);

const api = {
  async boot(options: {
    namespace: string;
    baseUrl: string;
    registryUrl?: string;
    startupTimeoutMs?: number;
  }) {
    runtime = [];
    rendered = [];
    const model: OpenAIModel = {
      id: 'first',
      name: 'first',
      provider: 'fixture',
      api: 'openai-completions',
      baseUrl: options.baseUrl,
      contextWindow: 32768,
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      textOnlyContent: true,
    };
    connections = {
      root: '/project',
      workerUrl: '/dist/rifty/no-coi-toolchain-worker.js',
      probeBaseUrl: '/dist/rifty/',
      storage: { namespace: options.namespace, persistence: 'required' },
      startupTimeoutMs: options.startupTimeoutMs,
      registryUrl: options.registryUrl,
      provider: 'fixture',
      models: [model],
      model: model.id,
      apiKey: 'fixture-key',
      renderSupport: (report) => {
        supportView.textContent = JSON.stringify(report);
      },
      renderRuntime: (event) => {
        runtime.push(event);
        if (event.type === 'progress') progressView.textContent = JSON.stringify(event);
      },
      renderTranscript: (transcript) => {
        rendered.push(transcript);
        view.textContent = JSON.stringify(transcript);
      },
    };
    try {
      host = await openReferenceHost(connections);
      return {
        coi: crossOriginIsolated,
        support: host.support,
        runtime,
        registryConnected: host.sandbox.toolchain.registryConnected,
      };
    } catch (error) {
      return { kind: sandboxErrorKind(error), runtime };
    }
  },
  async prepare(snapshot: SandboxSnapshotSource, files?: Record<string, string>) {
    await host.prepare({ snapshot, files });
    return { runtime };
  },
  open: () => host.call(() => host.sandbox.toolchain.open({ cwd: connections.root })),
  async conflict(snapshot: SandboxSnapshotSource) {
    try {
      await host.prepare({ snapshot });
    } catch (error) {
      return sandboxErrorKind(error);
    }
    throw new Error('Expected snapshot conflict');
  },
  async send(prompt: string) {
    await host.agent.send(prompt);
    return { trace: await host.agent.exportTrace(), transcript: host.transcript, rendered };
  },
  switchModel() {
    const first = connections.models[0]!;
    host.models.setProvider(
      createOpenAIProvider({
        id: connections.provider,
        apiKey: connections.apiKey,
        models: [first, { ...first, id: 'second', name: 'second' }],
      }),
    );
    host.agent.setModel('second');
  },
  async write(path: string, text: string) {
    try {
      await host.call(() => host.project.fs.writeFile(path, text));
      return 'written';
    } catch (error) {
      return sandboxErrorKind(error);
    }
  },
  read: (path: string) => host.call(() => host.project.fs.readFile(path, 'utf8')),
  run: (command: string) => host.call(() => host.project.run(command).completion),
  download: () => host.downloadTrace(),
  normalize: normalizeTerminalLines,
  close: () => host.close(),
};
Reflect.set(globalThis, 'referenceHost', api);
