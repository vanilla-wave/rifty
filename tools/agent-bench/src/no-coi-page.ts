import type { AgentRunLimits, AgentSessionEvent, SandboxAgentHostOptions } from '@riftydev/agent';
import { registerServiceWorker } from '@riftydev/sdk/service-worker';
import { openReferenceHost } from '../../../tests/integration/fixtures/workbench-vite-consumer/src/host.ts';
import type { Endpoint } from './config.ts';
import type { FileTree } from './files.ts';
let host: Awaited<ReturnType<typeof openReferenceHost>>;
let mode: 'commands' | 'preview' = 'commands';
const preview = document.querySelector('iframe')!;
async function snapshot(): Promise<FileTree> {
  const files: FileTree = Object.create(null);
  async function walk(path: string) {
    for (const entry of await host.project.fs.readdir(path || '.')) {
      if (['node_modules', '.git', 'dist'].includes(entry.name)) continue;
      const name = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory) await walk(name);
      else files[name] = await host.project.fs.readFile(name, 'utf8');
    }
  }
  await walk('');
  return files;
}
const bench = {
  async boot(
    files: FileTree,
    options: {
      endpoint: Endpoint;
      apiKey?: string;
      policies?: SandboxAgentHostOptions['policies'];
    } & AgentRunLimits,
  ) {
    if (crossOriginIsolated) throw new Error('Benchmark no-COI page unexpectedly isolated');
    const { maxToolCalls, runTimeoutMs } = options;
    const { thinking, temperature, envKey: _envKey, ...model } = options.endpoint;
    host = await openReferenceHost({
      workerUrl: '/rifty/no-coi-toolchain-worker.js',
      probeBaseUrl: '/rifty/',
      storage: { namespace: 'bench', persistence: 'required' },
      root: '/bench',
      registryUrl: '/npm-registry',
      provider: model.provider,
      models: [model],
      model: model.id,
      apiKey: options.apiKey,
      policies: options.policies,
      mode: () => mode,
      modelOptions: {
        [model.id]: {
          ...(thinking && thinking !== 'off' ? { reasoning: thinking } : {}),
          ...(temperature === undefined ? {} : { temperature }),
        },
      },
      limits: { maxToolCalls, runTimeoutMs },
    });
    try {
      await host.prepare({ files, install: { registryUrl: '/npm-registry' } });
    } catch (error) {
      await host.close();
      throw error;
    }
    return snapshot();
  },
  async run(prompt: string) {
    const events: AgentSessionEvent[] = [];
    const detach = host.agent.subscribe((event) => {
      if (
        (event.type === 'agent' && event.event.type === 'message_end') ||
        ['retry', 'compaction', 'repeated-call'].includes(event.type)
      )
        events.push(structuredClone(event));
    });
    try {
      await host.agent.send(prompt);
      return { trace: await host.agent.exportTrace(), events };
    } finally {
      detach();
    }
  },
  snapshot,
  apply: (files: FileTree) => host.prepare({ files }),
  command: (line: string) => host.call(() => host.project.run(line).completion),
  async preview() {
    await registerServiceWorker('/rifty/sw.js');
    const resident = await host.sandbox.toolchain.startBin({
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
    await host?.close();
  },
};
Reflect.set(globalThis, 'bench', bench);
export type NoCoiPage = typeof bench;
