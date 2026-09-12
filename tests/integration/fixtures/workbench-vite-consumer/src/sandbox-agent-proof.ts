import {
  type AgentTrace,
  createAgentSession,
  createBrowserAgentPreview,
  createSandboxAgentHost,
} from '@riftydev/agent';
import type { ToolchainSandbox } from '@riftydev/sdk';
import { scriptedProvider } from './agent-scripted-provider';

const settings = { baseUrl: 'https://scripted.invalid/v1', model: 'scripted' };
export const toolResults = (trace: AgentTrace) =>
  trace.transcript.filter((message) => message.role === 'toolResult');

export async function sandboxAgentPolicy(sandbox: ToolchainSandbox) {
  await sandbox.fs.writeFile('/agent/locked/keep.txt', 'keep');
  await sandbox.fs.writeFile('/outside.txt', 'outside');
  await sandbox.fs.writeFile(
    '/agent/out.cjs',
    "process.stdout.write('next\\n'); process.stderr.write('stderr\\n');",
  );
  const projectOptions = {
    root: '/agent',
    readonlyPaths: ['locked'],
    allowedCommands: ['pwd', 'echo', 'cd', 'node'],
  };
  const priorCommand = 'cd src && RUN_VALUE=prior && pwd';
  const nextCommand = 'pwd && echo "$RUN_VALUE" && node out.cjs';
  const provider = scriptedProvider([
    [
      { name: 'write_file', args: { path: 'src/created.txt', content: 'retained' } },
      {
        name: 'edit_file',
        args: { path: 'src/created.txt', old: 'retained', new: 'saved' },
      },
      { name: 'read_file', args: { path: 'src/created.txt' } },
      { name: 'glob', args: { pattern: '**/*.txt' } },
      { name: 'grep', args: { pattern: 'saved' } },
      { name: 'write_file', args: { path: 'locked/keep.txt', content: 'bad' } },
      { name: 'write_file', args: { path: '../outside.txt', content: 'bad' } },
      { name: 'shell', args: { command: 'touch forbidden.txt' } },
      { name: 'shell', args: { command: priorCommand } },
    ],
    { error: 'provider failed after committed write' },
    [{ name: 'shell', args: { command: nextCommand } }],
    'Continued with the retained write.',
  ]);
  const agent = createAgentSession({
    host: createSandboxAgentHost({
      sandbox,
      project: projectOptions,
      mode: () => 'commands',
    }),
    settings,
    fetch: provider.fetch,
  });
  try {
    await agent.send('Edit and search the project, respecting its policy.');
    const failed = await agent.exportTrace();
    await agent.send('Continue; run the next command.');
    const trace = await agent.exportTrace();
    const project = sandbox.project(projectOptions);
    await project.run(priorCommand).completion;
    const nativeRun = project.run(nextCommand);
    const nativeOutput: { stream: 'stdout' | 'stderr'; chunk: string }[] = [];
    nativeRun.onOutput((event) => nativeOutput.push(event));
    const reference = await nativeRun.completion;
    const denied = await project.fs.writeFile('locked/keep.txt', 'bad').then(
      () => null,
      (error: Error & { code?: string; path?: string; effects?: unknown }) => ({
        name: error.name,
        message: error.message,
        code: error.code,
        path: error.path,
        effects: error.effects,
      }),
    );
    return {
      failed,
      trace,
      requests: provider.requests,
      reference,
      nativeOutput,
      denied,
      nextCommand,
      saved: await project.fs.readFile('src/created.txt', 'utf8'),
      locked: await project.fs.readFile('locked/keep.txt', 'utf8'),
      outside: await sandbox.fs.readFile('/outside.txt', 'utf8'),
      files: await project.fs.readdir('.'),
    };
  } finally {
    await agent.dispose();
  }
}

export async function sandboxAgentStop(sandbox: ToolchainSandbox, hard: boolean) {
  await sandbox.fs.writeFile('/agent-stop/seed', 'seed');
  await sandbox.fs.writeFile('/agent-stop/spin.cjs', "console.log('entered'); while (true) {}");
  const command = hard ? 'node spin.cjs' : 'echo applied > applied.txt && echo entered && sleep 20';
  const provider = scriptedProvider([
    [
      { name: 'shell', args: { command } },
      { name: 'write_file', args: { path: 'skipped.txt', content: 'must not run' } },
    ],
    [{ name: 'shell', args: { command: 'pwd && echo next' } }],
    'Next command settled.',
  ]);
  const agent = createAgentSession({
    host: createSandboxAgentHost({
      sandbox,
      project: { root: '/agent-stop' },
      mode: () => 'commands',
    }),
    settings,
    fetch: provider.fetch,
  });
  let entered!: () => void;
  const entrance = new Promise<void>((resolve) => {
    entered = resolve;
  });
  agent.subscribe((event) => {
    if (event.type === 'output' && event.chunk.includes('entered')) entered();
  });
  try {
    const running = agent.send('Run the long command.');
    await Promise.race([
      entrance,
      running.then(() => {
        throw new Error('Command never entered');
      }),
    ]);
    await agent.stop();
    await running;
    const stopped = await agent.exportTrace();
    await agent.send('Run the next command.');
    const project = sandbox.project({ root: '/agent-stop' });
    return {
      stopped,
      trace: await agent.exportTrace(),
      requests: provider.requests,
      files: await project.fs.readdir('.'),
      applied: hard ? null : await project.fs.readFile('applied.txt', 'utf8'),
    };
  } finally {
    await agent.dispose();
  }
}

export async function sandboxAgentCycle(
  sandbox: ToolchainSandbox,
  input: {
    readonly root: string;
    readonly path: string;
    readonly original: string;
    readonly port: number;
  },
) {
  const project = sandbox.project({ root: input.root });
  let mode: 'commands' | 'preview' = 'commands';
  let previewUrl = '';
  const frame = document.createElement('iframe');
  frame.id = 'sandbox-agent-preview';
  const first = `${input.original}\ndocument.body.dataset.agentProof = 'agent-first';\n`;
  const repaired = first.replace('agent-first', 'agent-repaired');
  const provider = scriptedProvider([
    [{ name: 'write_file', args: { path: input.path, content: first } }],
    [{ name: 'shell', args: { command: 'npm run build' } }],
    'Built.',
    [
      { name: 'preview_fetch', args: { path: input.path } },
      { name: 'preview_query', args: { selector: 'body' } },
    ],
    'Preview inspected.',
    [{ name: 'write_file', args: { path: input.path, content: 'const broken = ;' } }],
    [{ name: 'shell', args: { command: 'npm run build' } }],
    [{ name: 'write_file', args: { path: input.path, content: repaired } }],
    [{ name: 'shell', args: { command: 'npm run build' } }],
    'Repaired.',
  ]);
  const host = createSandboxAgentHost({
    sandbox,
    project: { root: input.root },
    mode: () => mode,
    preview: () =>
      previewUrl
        ? createBrowserAgentPreview({ url: () => previewUrl, frame: () => frame })
        : undefined,
  });
  const agent = createAgentSession({
    host,
    settings: { ...settings, runTimeoutMs: 180_000 },
    fetch: provider.fetch,
  });
  const start = async () => {
    const resident = await sandbox.toolchain.startBin({
      cwd: input.root,
      binPath: `${input.root}/node_modules/.bin/vite`,
      args: ['--host', '127.0.0.1', '--port', String(input.port), '--strictPort'],
      port: input.port,
    });
    mode = 'preview';
    previewUrl = resident.previewUrl;
    frame.src = resident.previewUrl;
    if (!frame.isConnected) document.body.append(frame);
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => {
        clearInterval(timer);
        reject(new Error('Real preview did not render'));
      }, 60_000);
      const timer = setInterval(() => {
        if (frame.contentDocument?.body.dataset.agentProof) {
          clearTimeout(deadline);
          clearInterval(timer);
          resolve();
        }
      }, 25);
    });
    return frame.contentDocument?.body.dataset.agentProof;
  };
  try {
    await agent.send('Edit and build.');
    const firstStatus = agent.status();
    const firstPreview = await start();
    const deniedFile = await project.fs
      .readFile(input.path, 'utf8')
      .then(() => 'unexpected read', String);
    const deniedCommand = await project.run('echo forbidden-during-preview').completion;
    await agent.send('Inspect the preview.');
    const exited = await sandbox.stopResident();
    mode = 'commands';
    previewUrl = '';
    frame.src = 'about:blank';
    await agent.send('Edit, observe failed build and repair it.');
    const repairedSource = await project.fs.readFile(input.path, 'utf8');
    const trace = await agent.exportTrace();
    const repairedPreview = await start();
    const finalExit = await sandbox.stopResident();
    mode = 'commands';
    previewUrl = '';
    return {
      firstStatus,
      firstPreview,
      repairedPreview,
      deniedFile,
      deniedCommand,
      exited,
      finalExit,
      repairedSource,
      trace,
      requests: provider.requests,
    };
  } finally {
    frame.remove();
    await agent.dispose();
  }
}
