import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { redact, secretValues } from '../config.ts';
import { readTree, writeTree } from '../files.ts';
import { eventMetrics } from '../metrics.ts';
import {
  decodeProcessOutput,
  freePort,
  killProcessGroup,
  runOrThrow,
  spawnLoggedServer,
  waitHttpReady,
} from '../proc.ts';
import { runCodex } from './native-codex.ts';
import { nativeExtension } from './native-extension.ts';
import type { Input, Observation, Prepared } from './types.ts';

export async function prepareLocal(
  input: Input,
  participant: 'pi' | 'codex' = 'pi',
): Promise<Prepared> {
  const { task, endpoint, config, dir, key } = input;
  if (participant === 'codex' && !config.codex)
    throw new Error('native-codex requires explicit config.codex');
  const secrets = secretValues(endpoint, key);
  const workspace = await mkdtemp(join(tmpdir(), 'rifty-agent-bench-native-'));
  // Package-manager launchers can inject checkout modules into every child Node process.
  const nativeEnv = { ...process.env, NODE_PATH: undefined };
  const home = join(dir, 'pi-home');
  await mkdir(home, { recursive: true });
  await writeTree(workspace, task.files);
  const installed = await runOrThrow('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: workspace,
    env: nativeEnv,
    timeoutMs: 300000,
    signal: input.signal,
  });
  await writeFile(
    join(dir, 'install.log'),
    redact(`${installed.stdout}\n${installed.stderr}`, secrets),
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
  const codexVersion =
    participant === 'codex'
      ? (
          await runOrThrow('codex', ['--version'], {
            cwd: workspace,
            env: nativeEnv,
            timeoutMs: 30000,
            signal: input.signal,
          })
        ).stdout.trim()
      : undefined;
  const port = await freePort();
  const previewUrl = `http://127.0.0.1:${port}/`;
  const start = () =>
    spawnLoggedServer(
      task.node ? process.execPath : join(workspace, 'node_modules/.bin/vite'),
      task.node ? ['src/main.js'] : ['--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      {
        cwd: workspace,
        env: { ...nativeEnv, PORT: String(port) },
        logPath: join(dir, 'dev-server.log'),
        detached: true,
      },
    );
  let server = start();
  let context: Awaited<ReturnType<typeof input.browser.newContext>> | undefined;
  let agent: ChildProcess | undefined;
  let stopped = false;
  const stop = () => {
    if (!agent || stopped) return;
    stopped = true;
    void killProcessGroup(agent, participant === 'codex' ? 'SIGINT' : 'SIGTERM');
  };
  input.signal?.addEventListener('abort', stop, { once: true });
  try {
    await waitHttpReady(previewUrl, 120000, 'native dev server');
    context = await input.browser.newContext();
    const page = await context.newPage();
    const extension = join(dir, 'native-extension.ts');
    if (participant === 'pi') {
      await writeFile(extension, nativeExtension(dir, endpoint, config.limits));
      await writeFile(
        join(home, 'models.json'),
        JSON.stringify({
          providers: {
            [endpoint.provider]: {
              baseUrl: endpoint.baseUrl,
              api: 'openai-completions',
              apiKey: endpoint.envKey ? `$${endpoint.envKey}` : 'bench-no-auth-sentinel',
              models: [
                (() => {
                  const {
                    envKey: _envKey,
                    provider: _provider,
                    thinking: _thinking,
                    temperature,
                    headers: _headers,
                    ...model
                  } = endpoint;
                  return {
                    ...model,
                    samplingParams: {
                      ...(temperature === undefined ? {} : { temperature }),
                      ...model.samplingParams,
                    },
                  };
                })(),
              ],
            },
          },
        }),
      );
      await writeFile(
        join(home, 'settings.json'),
        JSON.stringify({
          retry: { enabled: true, maxRetries: 3, baseDelayMs: 2000, provider: { maxRetries: 0 } },
        }),
      );
    }
    return {
      context,
      page,
      before,
      workspace,
      codexVersion,
      async run(): Promise<Observation> {
        if (participant === 'codex')
          return runCodex(
            input,
            workspace,
            nativeEnv,
            (child) => {
              agent = child;
            },
            stop,
          );
        const cli = resolve(
          'tools/agent-bench/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
        );
        const child = spawn(
          process.execPath,
          [
            cli,
            '--provider',
            endpoint.provider,
            '--model',
            endpoint.id,
            '--thinking',
            endpoint.thinking ?? 'off',
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
            env: {
              ...nativeEnv,
              PI_CODING_AGENT_DIR: home,
              PI_OFFLINE: '1',
              PI_TELEMETRY: '0',
              RIFTY_BENCH_MODEL_HEADERS: JSON.stringify(endpoint.headers ?? {}),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true,
          },
        );
        agent = child;
        decodeProcessOutput(child);
        if (input.signal?.aborted) stop();
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: string) => {
          stdout += chunk;
        });
        child.stderr.on('data', (chunk: string) => {
          stderr += chunk;
        });
        const code = await new Promise<number | null>((resolve, reject) => {
          child.once('error', reject);
          child.once('close', resolve);
        });
        const events = stdout
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>);
        const end = events.findLast((event) => event.type === 'agent_end') as
          | {
              messages?: {
                role: string;
                toolName?: string;
                content?: { type?: string; text?: string }[];
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
        await writeFile(join(dir, 'native-stderr.log'), redact(stderr, secrets));
        return {
          ...eventMetrics(events, endpoint.contextWindow, agentStatus),
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
            stderr: redact(stderr, secrets),
          },
          terminalTail: redact(
            [
              ...messages
                .filter((message) => message.role === 'toolResult' && message.toolName === 'bash')
                .map((message) =>
                  (message.content ?? [])
                    .filter((block) => block.type === 'text')
                    .map((block) => block.text ?? '')
                    .join(''),
                ),
              stderr,
            ]
              .filter(Boolean)
              .join('\n')
              .slice(-16000),
            secrets,
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
        input.signal?.removeEventListener('abort', stop);
        await killProcessGroup(agent ?? null, participant === 'codex' ? 'SIGINT' : 'SIGTERM');
        await context!.close();
        await killProcessGroup(server);
      },
    };
  } catch (error) {
    input.signal?.removeEventListener('abort', stop);
    await killProcessGroup(agent ?? null, participant === 'codex' ? 'SIGINT' : 'SIGTERM');
    await context?.close();
    await killProcessGroup(server);
    throw error;
  }
}
