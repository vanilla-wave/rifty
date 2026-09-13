import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { redact } from '../config.ts';
import { readTree, writeTree } from '../files.ts';
import {
  freePort,
  killProcessGroup,
  runOrThrow,
  spawnLoggedServer,
  waitHttpReady,
} from '../proc.ts';
import { nativeExtension } from './native-extension.ts';
import type { Input, Observation, Prepared } from './types.ts';

export async function prepareLocal(input: Input): Promise<Prepared> {
  const { task, endpoint, config, dir, key } = input;
  const workspace = join(dir, 'workspace');
  const home = join(dir, 'pi-home');
  await mkdir(home, { recursive: true });
  await writeTree(workspace, task.files);
  const installed = await runOrThrow('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: workspace,
    timeoutMs: 300000,
  });
  await writeFile(
    join(dir, 'install.log'),
    redact(`${installed.stdout}\n${installed.stderr}`, key),
  );
  await runOrThrow('git', ['init', '-q', '-b', 'main'], { cwd: workspace, timeoutMs: 30000 });
  await runOrThrow('git', ['add', '.'], { cwd: workspace, timeoutMs: 30000 });
  await runOrThrow(
    'git',
    [
      '-c',
      'user.name=agent-bench',
      '-c',
      'user.email=bench@localhost',
      'commit',
      '-qm',
      'Benchmark baseline',
    ],
    { cwd: workspace, timeoutMs: 30000 },
  );
  const before = await readTree(workspace);
  const port = await freePort();
  const previewUrl = `http://127.0.0.1:${port}/`;
  const start = () =>
    spawnLoggedServer(
      task.node ? process.execPath : join(workspace, 'node_modules/.bin/vite'),
      task.node ? ['src/main.js'] : ['--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      {
        cwd: workspace,
        env: { ...process.env, PORT: String(port) },
        logPath: join(dir, 'dev-server.log'),
        detached: true,
      },
    );
  let server = start();
  let context: Awaited<ReturnType<typeof input.browser.newContext>> | undefined;
  try {
    await waitHttpReady(previewUrl, 120000, 'native dev server');
    context = await input.browser.newContext();
    const page = await context.newPage();
    const extension = join(dir, 'native-extension.ts');
    await writeFile(extension, nativeExtension(dir, endpoint, config.limits));
    await writeFile(
      join(home, 'models.json'),
      JSON.stringify({
        providers: {
          bench: {
            baseUrl: endpoint.baseUrl,
            api: 'openai-completions',
            apiKey: endpoint.envKey ? `$${endpoint.envKey}` : 'bench-no-auth-sentinel',
            models: [
              {
                id: endpoint.model,
                name: endpoint.model,
                reasoning: false,
                input: ['text'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128000,
                maxTokens: 8192,
              },
            ],
          },
        },
      }),
    );
    await writeFile(join(home, 'settings.json'), JSON.stringify({ retry: { enabled: false } }));
    return {
      context,
      page,
      before,
      workspace,
      async run(): Promise<Observation> {
        const cli = resolve(
          'tools/agent-bench/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
        );
        const child = spawn(
          process.execPath,
          [
            cli,
            '--provider',
            'bench',
            '--model',
            endpoint.model,
            '--mode',
            'json',
            '--no-session',
            '--no-extensions',
            '--no-skills',
            '--no-prompt-templates',
            '--no-themes',
            '--no-context-files',
            '-e',
            extension,
            '-p',
            task.prompt,
          ],
          {
            cwd: workspace,
            env: { ...process.env, PI_CODING_AGENT_DIR: home, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk;
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk;
        });
        const code = await new Promise<number | null>((resolve, reject) => {
          child.once('error', reject);
          child.once('close', resolve);
        });
        const events = stdout
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(redact(line, key)) as Record<string, unknown>);
        const end = events.findLast((event) => event.type === 'agent_end') as
          | {
              messages?: {
                role: string;
                stopReason?: string;
                usage?: { input?: number; output?: number; totalTokens?: number };
              }[];
            }
          | undefined;
        const messages = end?.messages ?? [];
        const last = messages.findLast((message) => message.role === 'assistant');
        const admission = JSON.parse(
          await readFile(join(dir, 'native-admission.json'), 'utf8'),
        ) as { calls: number; budget: string | null };
        const agentStatus = admission.budget
          ? 'budget-exceeded'
          : last?.stopReason === 'error' || code !== 0
            ? 'error'
            : last?.stopReason === 'aborted'
              ? 'aborted'
              : 'done';
        const requests = await readFile(join(dir, 'provider-requests.jsonl'), 'utf8').catch(
          () => '',
        );
        await writeFile(join(dir, 'native-stderr.log'), redact(stderr, key));
        return {
          agentStatus,
          turns: events.filter((event) => event.type === 'turn_end').length,
          toolCalls: admission.calls,
          usage: messages
            .filter((message) => message.role === 'assistant')
            .map((message) => message.usage),
          trace: {
            events,
            requests: requests
              .split('\n')
              .filter(Boolean)
              .map((line) => JSON.parse(line)),
            admission,
            exitCode: code,
            stderr: redact(stderr, key),
          },
          terminalTail: redact(
            `${JSON.stringify(messages.filter((message) => message.role === 'toolResult')).slice(
              -16000,
            )}\n${stderr}`,
            key,
          ),
        };
      },
      async preview() {
        if (task.node) {
          await killProcessGroup(server);
          server = start();
          await waitHttpReady(previewUrl, 120000, 'updated native server');
        }
        await page.goto(previewUrl);
        return { view: page, previewUrl };
      },
      snapshot: () => readTree(workspace),
      async close() {
        await context!.close();
        await killProcessGroup(server);
      },
    };
  } catch (error) {
    await context?.close();
    await killProcessGroup(server);
    throw error;
  }
}
