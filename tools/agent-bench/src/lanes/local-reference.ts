/**
 * Lane `local-reference` (ADR-0191): fresh temp dir per run → same preset
 * source + seed overlay as the playground → real `npm install`
 * (registry.npmjs.org) → local dev server (vite / node entry) → the pinned
 * Pi CLI (`@earendil-works/pi-coding-agent`, same version+model as the rifty
 * lane, isolated PI_CODING_AGENT_DIR) → session/event JSONL kept as the trace.
 * The rifty vs local delta isolates the environment variable; this lane is the
 * ceiling estimate.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile as fsReadFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { BenchConfig, EndpointConfig } from '../config.ts';
import { writeFileTree } from '../fs-tree.ts';
import { overlaySeed } from '../seed.ts';
import type { BenchTask } from '../tasks.ts';
import { templateSpec, templateWorkspaceFiles } from '../templates.ts';
import type { LaneAdapter, LaneTrace, PreparedRun, RunOutcome } from './types.ts';

const BENCH_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PI_BIN = join(BENCH_ROOT, 'node_modules', '.bin', 'pi');
const NPM_REGISTRY = 'https://registry.npmjs.org';
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const SERVER_READY_TIMEOUT_MS = 120_000;

/** Pi's default coding-assistant system prompt — the baseline equivalent of
 *  the rifty profile `pi-baseline+rifty-adapter-v1` (ADR-0190). */
export const LOCAL_REFERENCE_PROMPT_PROFILE = 'pi-baseline';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (address === null || typeof address === 'string') {
        srv.close();
        reject(new Error('agent-bench: could not allocate a free port'));
        return;
      }
      const { port } = address;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runToCompletion(
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error(
          `agent-bench: \`${cmd} ${args.join(' ')}\` timed out after ${opts.timeoutMs}ms\n${stderr.slice(-2000)}`,
        ),
      );
    }, opts.timeoutMs);
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function runOrThrow(
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<RunResult> {
  const result = await runToCompletion(cmd, args, opts);
  if (result.code !== 0) {
    throw new Error(
      `agent-bench: \`${cmd} ${args.join(' ')}\` exited ${result.code}\nstdout: ${result.stdout.slice(-2000)}\nstderr: ${result.stderr.slice(-2000)}`,
    );
  }
  return result;
}

async function waitHttpReady(url: string, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no attempt made';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = (err as Error).message;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`agent-bench: ${what} not ready at ${url} after ${timeoutMs}ms (${lastError})`);
}

function tailOf(path: string, bytes: number): string {
  try {
    const text = readFileSync(path, 'utf8');
    return text.length > bytes ? text.slice(-bytes) : text;
  } catch {
    return `(no output captured at ${path})`;
  }
}

interface DevServer {
  child: ChildProcess;
  port: number;
  logPath: string;
}

function spawnLoggedServer(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; logPath: string },
): ChildProcess {
  writeFileSync(opts.logPath, `$ ${cmd} ${args.join(' ')}\n`, 'utf8');
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const append = (d: Buffer): void => appendFileSync(opts.logPath, d.toString(), 'utf8');
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  return child;
}

function killChild(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 2000).unref();
  });
}

function piVersion(): string {
  const pkgPath = join(
    BENCH_ROOT,
    'node_modules',
    '@earendil-works',
    'pi-coding-agent',
    'package.json',
  );
  return (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;
}

class LocalPreparedRun implements PreparedRun {
  readonly workspace: string;
  readonly previewUrl: string;

  private readonly task: BenchTask;
  private readonly runDir: string;
  private readonly endpoint: EndpointConfig;
  private readonly limits: BenchConfig['limits'];
  private server: DevServer;
  private readonly serverKind: 'vite' | 'node';
  private readonly serverEntry: string;

  private pi: ChildProcess | null = null;
  private piExit: Promise<RunOutcome> | null = null;
  private piExitCode: number | null = null;
  private budgetReason: string | null = null;
  private turns = 0;
  private toolCalls = 0;

  constructor(args: {
    task: BenchTask;
    runDir: string;
    workspace: string;
    endpoint: EndpointConfig;
    limits: BenchConfig['limits'];
    server: DevServer;
    serverKind: 'vite' | 'node';
    serverEntry: string;
  }) {
    this.task = args.task;
    this.runDir = args.runDir;
    this.workspace = args.workspace;
    this.endpoint = args.endpoint;
    this.limits = args.limits;
    this.server = args.server;
    this.serverKind = args.serverKind;
    this.serverEntry = args.serverEntry;
    this.previewUrl = `http://127.0.0.1:${args.server.port}/`;
  }

  private get eventsPath(): string {
    return join(this.runDir, 'pi-events.jsonl');
  }
  private get piStderrPath(): string {
    return join(this.runDir, 'pi-stderr.log');
  }
  private get sessionsDir(): string {
    return join(this.runDir, 'pi-sessions');
  }
  private get piHome(): string {
    return join(this.runDir, 'pi-home');
  }

  async sendPrompt(text: string): Promise<void> {
    if (this.pi) throw new Error('agent-bench: sendPrompt called twice (cold start only)');
    writeFileSync(this.eventsPath, '', 'utf8');
    writeFileSync(this.piStderrPath, '', 'utf8');
    mkdirSync(this.sessionsDir, { recursive: true });
    const child = spawn(
      PI_BIN,
      [
        '--provider',
        'bench',
        '--model',
        this.endpoint.model,
        '--mode',
        'json',
        '--session-dir',
        this.sessionsDir,
        '-p',
        text,
      ],
      {
        cwd: this.workspace,
        env: { ...process.env, PI_CODING_AGENT_DIR: this.piHome },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    this.pi = child;
    child.stderr?.on('data', (d: Buffer) =>
      appendFileSync(this.piStderrPath, d.toString(), 'utf8'),
    );

    const openToolCalls = new Map<string, { name: string; startedAt: number }>();
    const trip = (reason: string): void => {
      if (this.budgetReason !== null) return;
      this.budgetReason = reason;
      child.kill('SIGKILL');
    };
    const runTimer = setTimeout(
      () => trip(`runTimeoutMs (${this.limits.runTimeoutMs}ms) exceeded`),
      this.limits.runTimeoutMs,
    );
    const toolTimer = setInterval(() => {
      const now = Date.now();
      for (const [, call] of openToolCalls) {
        if (now - call.startedAt > this.limits.toolTimeoutMs) {
          trip(`toolTimeoutMs (${this.limits.toolTimeoutMs}ms) exceeded by tool '${call.name}'`);
        }
      }
    }, 1000);

    const rl = createInterface({ input: child.stdout as NodeJS.ReadableStream });
    rl.on('line', (line) => {
      appendFileSync(this.eventsPath, `${line}\n`, 'utf8');
      let event: { type?: string; toolCallId?: string; toolName?: string };
      try {
        event = JSON.parse(line) as typeof event;
      } catch {
        // --mode json should be pure JSONL; keep the raw line as evidence, loudly.
        appendFileSync(this.piStderrPath, `[non-json stdout] ${line}\n`, 'utf8');
        return;
      }
      if (event.type === 'turn_end') this.turns += 1;
      if (event.type === 'tool_execution_start') {
        this.toolCalls += 1;
        openToolCalls.set(event.toolCallId ?? String(this.toolCalls), {
          name: event.toolName ?? 'unknown',
          startedAt: Date.now(),
        });
        if (this.toolCalls > this.limits.maxToolCalls) {
          trip(`maxToolCalls (${this.limits.maxToolCalls}) exceeded`);
        }
      }
      if (event.type === 'tool_execution_end' && event.toolCallId) {
        openToolCalls.delete(event.toolCallId);
      }
    });

    this.piExit = new Promise<RunOutcome>((resolve, reject) => {
      child.once('error', (err) => {
        clearTimeout(runTimer);
        clearInterval(toolTimer);
        reject(new Error(`agent-bench: failed to run pi CLI at ${PI_BIN}: ${err.message}`));
      });
      child.once('exit', (code) => {
        clearTimeout(runTimer);
        clearInterval(toolTimer);
        rl.close();
        this.piExitCode = code;
        // Non-zero exit without a tripped budget is still 'done': the run ended
        // (e.g. provider error) and the judge + human classification handle it;
        // exit code and stderr stay in the trace as evidence.
        resolve(this.budgetReason === null ? 'done' : 'budget-exceeded');
      });
    });
  }

  async waitDone(): Promise<RunOutcome> {
    if (!this.piExit) throw new Error('agent-bench: waitDone before sendPrompt');
    const outcome = await this.piExit;
    if (this.serverKind === 'node') {
      // Node entry has no HMR: restart it so the judge observes the agent's
      // edits (in the rifty lane the dev script re-runs the entry likewise).
      await killChild(this.server.child);
      const child = spawnLoggedServer('node', [this.serverEntry], {
        cwd: this.workspace,
        env: { ...process.env, PORT: String(this.server.port) },
        logPath: this.server.logPath,
      });
      this.server = { ...this.server, child };
      await waitHttpReady(this.previewUrl, SERVER_READY_TIMEOUT_MS, 'restarted node server');
    }
    return outcome;
  }

  async collectTrace(): Promise<LaneTrace> {
    return {
      turns: this.turns,
      toolCalls: this.toolCalls,
      artifacts: {
        events: this.eventsPath,
        sessions: this.sessionsDir,
        piStderr: this.piStderrPath,
        devServer: this.server.logPath,
        npmInstall: join(this.runDir, 'npm-install.log'),
      },
      agentExitCode: this.piExitCode,
      budgetReason: this.budgetReason,
    };
  }

  async terminalTail(): Promise<string> {
    return [
      `--- dev server (${this.server.logPath}) ---`,
      tailOf(this.server.logPath, 4000),
      `--- pi stderr (${this.piStderrPath}) ---`,
      tailOf(this.piStderrPath, 2000),
    ].join('\n');
  }

  async gitDiff(): Promise<string> {
    // -A stages new/deleted files so untracked agent output shows in the diff.
    await runOrThrow('git', ['add', '-A'], { cwd: this.workspace, timeoutMs: 30_000 });
    const result = await runOrThrow('git', ['diff', '--cached'], {
      cwd: this.workspace,
      timeoutMs: 30_000,
    });
    return result.stdout;
  }

  async readFile(relPath: string): Promise<string> {
    return fsReadFile(join(this.workspace, relPath), 'utf8');
  }

  async cleanup(): Promise<void> {
    await killChild(this.pi);
    await killChild(this.server.child);
    rmSync(this.workspace, { recursive: true, force: true });
  }
}

export function createLocalReferenceLane(config: BenchConfig): LaneAdapter {
  const endpoint = config.endpoint;
  if (endpoint === null) {
    throw new Error(
      'agent-bench: lane local-reference needs an endpoint — provide `endpoint` in the config file or pass --mock-model',
    );
  }
  return {
    id: 'local-reference',
    promptProfile: LOCAL_REFERENCE_PROMPT_PROFILE,

    async laneVersions(): Promise<Record<string, string>> {
      return { pi: piVersion(), node: process.version, model: endpoint.model };
    },

    async prepare(task: BenchTask, runDir: string): Promise<PreparedRun> {
      mkdirSync(runDir, { recursive: true });
      const spec = templateSpec(task.templateId);
      const workspace = await mkdtemp(join(tmpdir(), `agent-bench-${task.slug}-`));

      // 1. Same preset tree the playground seeds + the task's seed overlay.
      writeFileTree(workspace, overlaySeed(templateWorkspaceFiles(task.templateId), task.seed));

      // 2. Real git baseline (gitDiff = everything the agent changed).
      await runOrThrow('git', ['init', '-q', '-b', 'main'], { cwd: workspace, timeoutMs: 30_000 });
      await runOrThrow('git', ['config', 'user.email', 'agent-bench@rifty.local'], {
        cwd: workspace,
        timeoutMs: 30_000,
      });
      await runOrThrow('git', ['config', 'user.name', 'agent-bench'], {
        cwd: workspace,
        timeoutMs: 30_000,
      });
      // 3. Real npm install from the public registry (pinned, ~/.npmrc-independent).
      const install = await runToCompletion(
        'npm',
        ['install', `--registry=${NPM_REGISTRY}`, '--no-audit', '--no-fund', '--loglevel=error'],
        { cwd: workspace, timeoutMs: INSTALL_TIMEOUT_MS },
      );
      writeFileSync(
        join(runDir, 'npm-install.log'),
        `exit ${install.code}\n${install.stdout}\n${install.stderr}`,
        'utf8',
      );
      if (install.code !== 0) {
        throw new Error(
          `agent-bench: npm install failed (exit ${install.code}) in ${workspace}\n${install.stderr.slice(-2000)}`,
        );
      }

      // Baseline commit AFTER install: package-lock.json is install fallout,
      // not an agent change — gitDiff must show only what the agent did.
      await runOrThrow('git', ['add', '-A'], { cwd: workspace, timeoutMs: 30_000 });
      await runOrThrow('git', ['commit', '-q', '-m', 'agent-bench baseline'], {
        cwd: workspace,
        timeoutMs: 30_000,
      });

      // 4. Local dev server on a free port.
      const port = await freePort();
      const logPath = join(runDir, 'dev-server.log');
      let serverKind: 'vite' | 'node';
      let serverEntry = '';
      let child: ChildProcess;
      if (spec.runtime === 'vite') {
        serverKind = 'vite';
        // --host 127.0.0.1: vite's default `localhost` bind may land on ::1
        // only; pin it to the loopback address previewUrl advertises.
        child = spawnLoggedServer(
          join(workspace, 'node_modules', '.bin', 'vite'),
          ['--strictPort', '--port', String(port), '--host', '127.0.0.1'],
          { cwd: workspace, env: { ...process.env }, logPath },
        );
      } else if (spec.runtime === 'node-server') {
        serverKind = 'node';
        serverEntry = spec.entry.relativePath.replace(/^\//, '');
        child = spawnLoggedServer('node', [serverEntry], {
          cwd: workspace,
          env: { ...process.env, PORT: String(port) },
          logPath,
        });
      } else {
        throw new Error(
          `agent-bench: template runtime '${spec.runtime}' has no local lane driver (task-set-v1 uses vite + node-server only)`,
        );
      }
      const previewUrl = `http://127.0.0.1:${port}/`;
      try {
        await waitHttpReady(previewUrl, SERVER_READY_TIMEOUT_MS, `${serverKind} dev server`);
      } catch (err) {
        await killChild(child);
        throw new Error(`${(err as Error).message}\nserver log tail:\n${tailOf(logPath, 2000)}`);
      }

      // 5. Isolated pi home: provider `bench` over the configured endpoint;
      // the key stays in the env var — pi resolves `$<envKey>` itself.
      const piHome = join(runDir, 'pi-home');
      mkdirSync(piHome, { recursive: true });
      writeFileSync(
        join(piHome, 'models.json'),
        `${JSON.stringify(
          {
            providers: {
              bench: {
                baseUrl: endpoint.baseUrl,
                api: 'openai-completions',
                apiKey: `$${endpoint.envKey}`,
                models: [{ id: endpoint.model }],
              },
            },
          },
          null,
          2,
        )}\n`,
        'utf8',
      );

      return new LocalPreparedRun({
        task,
        runDir,
        workspace,
        endpoint,
        limits: config.limits,
        server: { child, port, logPath },
        serverKind,
        serverEntry,
      });
    },
  };
}
