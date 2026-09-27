import {
  type AgentRunLimits,
  type AgentSession,
  type AgentSessionEvent,
  createAgentSession,
  createModels,
  createOpenAIProvider,
  createSandboxAgentHost,
} from '@riftydev/agent';
import { type ToolchainSandbox, createSandbox } from '@riftydev/sdk';
import type { Endpoint } from './config.ts';
import type { FileTree } from './files.ts';
let sandbox: ToolchainSandbox;
let agent: AgentSession;
let project: ReturnType<ToolchainSandbox['project']>;
let mode: 'commands' | 'preview' = 'commands';
const preview = document.querySelector('iframe')!;
async function snapshot(): Promise<FileTree> {
  const files: FileTree = Object.create(null);
  async function walk(path: string) {
    for (const entry of await project.fs.readdir(path || '.')) {
      if (['node_modules', '.git', 'dist'].includes(entry.name)) continue;
      const name = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory) await walk(name);
      else files[name] = await project.fs.readFile(name, 'utf8');
    }
  }
  await walk('');
  return files;
}
const bench = {
  async boot(files: FileTree, options: { endpoint: Endpoint; apiKey?: string } & AgentRunLimits) {
    if (crossOriginIsolated) throw new Error('Benchmark no-COI page unexpectedly isolated');
    sandbox = await createSandbox({
      requireCrossOriginIsolation: false,
      serviceWorkerUrl: '/rifty/sw.js',
      toolchain: { workerUrl: '/rifty/no-coi-toolchain-worker.js' },
    });
    project = sandbox.project({ root: '/bench' });
    for (const [path, text] of Object.entries(files)) await project.fs.writeFile(path, text);
    await sandbox.toolchain.install({ cwd: '/bench', registryUrl: '/npm-registry' });
    const { maxToolCalls, runTimeoutMs } = options;
    const { thinking, temperature, envKey: _envKey, ...model } = options.endpoint;
    const models = createModels();
    models.setProvider(
      createOpenAIProvider({ id: model.provider, apiKey: options.apiKey, models: [model] }),
    );
    agent = createAgentSession({
      host: createSandboxAgentHost({ sandbox, project: { root: '/bench' }, mode: () => mode }),
      models,
      model: model.id,
      modelOptions: {
        [model.id]: {
          ...(thinking && thinking !== 'off' ? { reasoning: thinking } : {}),
          ...(temperature === undefined ? {} : { temperature }),
        },
      },
      maxToolCalls,
      runTimeoutMs,
    });
    return snapshot();
  },
  async run(prompt: string) {
    const events: AgentSessionEvent[] = [];
    const detach = agent.subscribe((event) => {
      if (
        (event.type === 'agent' && event.event.type === 'message_end') ||
        ['retry', 'compaction', 'repeated-call'].includes(event.type)
      )
        events.push(structuredClone(event));
    });
    try {
      await agent.send(prompt);
      return { trace: await agent.exportTrace(), events };
    } finally {
      detach();
    }
  },
  snapshot,
  async preview() {
    const resident = await sandbox.toolchain.startBin({
      cwd: '/bench',
      binPath: '/bench/node_modules/.bin/vite',
      args: ['--host', '127.0.0.1', '--port', '5174', '--strictPort'],
      port: 5174,
    });
    mode = 'preview';
    preview.src = resident.previewUrl;
    return resident.previewUrl;
  },
  async close() {
    await agent?.dispose();
    await sandbox?.dispose();
  },
};
Reflect.set(globalThis, 'bench', bench);
export type NoCoiPage = typeof bench;
