/**
 * Lane `rifty` (ADR-0191): the playground + built-in AI mode through the SAME
 * chat a human uses. Per run: fresh browser context → deep-link boot
 * `/?preset=<id>&agentBench=1&autorun=1` → seed via `__riftyAgentBench.seed`
 * → type the prompt into the real chat textarea (prompt delivery is part of
 * the measured surface — no injection hook) → wait done / budget-exceeded →
 * `exportTrace()` as the lane trace. Settings pre-seed (localStorage
 * `rf.ai.v1`) is harness SETUP, exactly what a human does in the settings
 * dialog; the API key comes from the env var named in config and lands only
 * in the ephemeral context's storage — never in traces or reports.
 */
import type { ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, type BrowserContext, type Page, chromium } from '@playwright/test';
import type { BenchConfig, BenchLimits, EndpointConfig } from '../config.ts';
import { isHttpUp, killProcessGroup, spawnLoggedServer, waitHttpReady } from '../proc.ts';
import type { FileTree } from '../seed.ts';
import type { BenchTask } from '../tasks.ts';
import { templateSpec } from '../templates.ts';
import type { JudgePageHandle, LaneAdapter, LaneTrace, PreparedRun, RunOutcome } from './types.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const AI_SETTINGS_KEY = 'rf.ai.v1'; // apps/playground/src/ai/settings.ts
const BOOT_TIMEOUT_MS = 300_000;
const PLAYGROUND_READY_TIMEOUT_MS = 120_000;
const POLL_MS = 500;

/** ADR-0190 named profile the playground session runs (ai/prompt-profile.ts). */
export const RIFTY_PROMPT_PROFILE = 'pi-baseline+rifty-adapter-v1';

// ── pure pieces (unit-tested) ────────────────────────────────────────────────

/**
 * The exact object passed to `__riftyAgentBench.seed` — the task's seed
 * overlay verbatim (workspace-relative paths). The template tree itself IS the
 * preset the playground already booted; both lanes converge on
 * overlaySeed(templateWorkspaceFiles(id), THIS).
 */
export function benchSeedFiles(task: BenchTask): FileTree {
  return task.seed;
}

/** localStorage `rf.ai.v1` payload (AiSettings shape). `toolTimeoutMs` has no
 *  in-session knob — the harness enforces it by watching running tool cards. */
export function riftyAiSettings(
  endpoint: EndpointConfig,
  limits: BenchLimits,
  apiKey: string,
): Record<string, unknown> {
  return {
    baseUrl: endpoint.baseUrl,
    apiKey,
    model: endpoint.model,
    maxToolCalls: limits.maxToolCalls,
    runTimeoutMs: limits.runTimeoutMs,
  };
}

/**
 * Map the chat panel's `data-status` (AiRunStatus) to a run outcome.
 * 'error'/'aborted' still end the run as 'done' — the judge fails it with
 * evidence and a human classifies (provider / rifty-* / …); null = still going.
 */
export function mapAiStatusToOutcome(status: string): RunOutcome | null {
  switch (status) {
    case 'done':
    case 'error':
    case 'aborted':
      return 'done';
    case 'budget-exceeded':
      return 'budget-exceeded';
    case 'idle':
    case 'running':
      return null;
    default:
      throw new Error(`agent-bench: unknown AI run status '${status}'`);
  }
}

/** Structural view of the playground's AiSessionTrace (ai/trace.ts). */
export interface RiftyTrace {
  status?: string;
  transcript?: readonly { role?: string }[];
  toolCalls?: readonly unknown[];
  terminal?: readonly { command?: string; exitCode?: number; output?: string }[];
  budget?: { exceeded?: boolean; reason?: string };
  finalDiff?: unknown;
}

export function traceToLaneTrace(
  trace: RiftyTrace,
  artifacts: Record<string, string>,
  harnessBudgetReason: string | null,
): LaneTrace {
  return {
    turns: (trace.transcript ?? []).filter((m) => m.role === 'assistant').length,
    toolCalls: (trace.toolCalls ?? []).length,
    artifacts,
    agentExitCode: null, // in-browser session — no process exit code
    budgetReason:
      harnessBudgetReason ??
      (trace.budget?.exceeded ? (trace.budget.reason ?? 'budget-exceeded') : null),
  };
}

/** Terminal tail from the trace's agent-run shell records. */
export function renderTraceTerminal(trace: RiftyTrace): string {
  const runs = trace.terminal ?? [];
  if (runs.length === 0) return '(no agent shell runs this session)';
  return runs
    .map((run) => `$ ${run.command ?? ''}\n${run.output ?? ''}\n(exit ${run.exitCode ?? '?'})`)
    .join('\n')
    .slice(-4000);
}

interface DiffEntryLike {
  filepath?: string;
  change?: string;
  binary?: boolean;
  hunks?: {
    oldStart?: number;
    oldLines?: number;
    newStart?: number;
    newLines?: number;
    lines?: string[];
  }[];
}

/** Render the structured DiffEntry[] finalDiff as unified-diff-shaped text. */
export function renderFinalDiff(finalDiff: unknown): string {
  if (Array.isArray(finalDiff)) {
    if (finalDiff.length === 0) return '';
    const parts: string[] = [];
    for (const entry of finalDiff as DiffEntryLike[]) {
      parts.push(`diff --rifty a/${entry.filepath} b/${entry.filepath} (${entry.change})`);
      if (entry.binary) {
        parts.push(`Binary files a/${entry.filepath} and b/${entry.filepath} differ`);
        continue;
      }
      for (const hunk of entry.hunks ?? []) {
        parts.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
        parts.push(...(hunk.lines ?? []));
      }
    }
    return parts.join('\n');
  }
  const error = (finalDiff as { error?: unknown })?.error;
  if (typeof error === 'string') return `(git diff unavailable: ${error})`;
  return `(unrecognized finalDiff shape: ${JSON.stringify(finalDiff)})`;
}

// ── browser plumbing ─────────────────────────────────────────────────────────

interface ToolCardView {
  tool: string;
  running: boolean;
}

async function readToolCards(page: Page): Promise<ToolCardView[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="ai-tool-card"]')).map((el) => ({
      tool: el.getAttribute('data-tool') ?? 'unknown',
      // The summary shows a trailing "⋯" while the tool executes (AiChatPanel).
      running: el.querySelector('summary')?.textContent?.includes('⋯') ?? false,
    })),
  );
}

async function aiStatus(page: Page): Promise<string> {
  const status = await page
    .locator('[data-testid="ai-status"]')
    .getAttribute('data-status', { timeout: 5_000 });
  if (status === null) throw new Error('agent-bench: [data-testid="ai-status"] disappeared');
  return status;
}

class RiftyPreparedRun implements PreparedRun {
  readonly workspace: string;
  readonly previewUrl: string;

  private readonly context: BrowserContext;
  private readonly page: Page;
  private readonly runDir: string;
  private readonly limits: BenchLimits;
  private sent = false;
  private startedAt = 0;
  private harnessBudgetReason: string | null = null;
  private cachedTrace: RiftyTrace | null = null;
  private cachedLaneTrace: LaneTrace | null = null;

  constructor(args: {
    context: BrowserContext;
    page: Page;
    task: BenchTask;
    runDir: string;
    limits: BenchLimits;
    playgroundPort: number;
  }) {
    this.context = args.context;
    this.page = args.page;
    this.runDir = args.runDir;
    this.limits = args.limits;
    this.workspace = `rifty-vfs:${args.task.templateId}`;
    const devPort = templateSpec(args.task.templateId).defaultPort;
    this.previewUrl = `http://localhost:${args.playgroundPort}/preview/${devPort}/`;
  }

  async sendPrompt(text: string): Promise<void> {
    if (this.sent) throw new Error('agent-bench: sendPrompt called twice (cold start only)');
    this.sent = true;
    // The REAL chat input — prompt delivery is part of the measured surface.
    await this.page.fill('[data-testid="ai-input"]', text);
    await this.page.press('[data-testid="ai-input"]', 'Enter');
    this.startedAt = Date.now();
  }

  async waitDone(): Promise<RunOutcome> {
    if (!this.sent) throw new Error('agent-bench: waitDone before sendPrompt');
    // Backstop AFTER the session's own runTimeoutMs budget (pre-seeded from the
    // same config) — it fires only if the in-page enforcement is stuck.
    const hardDeadline = this.startedAt + this.limits.runTimeoutMs + 30_000;
    const pendingSince = new Map<number, number>();
    for (;;) {
      const status = await aiStatus(this.page);
      const outcome = mapAiStatusToOutcome(status);
      if (outcome !== null) return outcome;

      const now = Date.now();
      const cards = await readToolCards(this.page);
      cards.forEach((card, index) => {
        if (!card.running) {
          pendingSince.delete(index);
          return;
        }
        const since = pendingSince.get(index) ?? now;
        pendingSince.set(index, since);
        if (now - since > this.limits.toolTimeoutMs) {
          this.harnessBudgetReason = `toolTimeoutMs (${this.limits.toolTimeoutMs}ms) exceeded by tool '${card.tool}'`;
        }
      });
      if (this.harnessBudgetReason === null && now > hardDeadline) {
        this.harnessBudgetReason = `harness wall-clock (runTimeoutMs ${this.limits.runTimeoutMs}ms + 30s grace) exceeded`;
      }
      if (this.harnessBudgetReason !== null) {
        // Best-effort stop so exportTrace sees a settled session.
        await this.page.click('[data-testid="ai-stop"]', { timeout: 2_000 }).catch(() => undefined);
        return 'budget-exceeded';
      }
      await this.page.waitForTimeout(POLL_MS);
    }
  }

  private async exportTrace(): Promise<RiftyTrace> {
    if (this.cachedTrace !== null) return this.cachedTrace;
    const trace = (await this.page.evaluate(() =>
      (
        globalThis as typeof globalThis & {
          __riftyAgentBench: { exportTrace(): Promise<unknown> };
        }
      ).__riftyAgentBench.exportTrace(),
    )) as RiftyTrace;
    this.cachedTrace = trace;
    return trace;
  }

  async collectTrace(): Promise<LaneTrace> {
    if (this.cachedLaneTrace !== null) return this.cachedLaneTrace;
    const trace = await this.exportTrace();
    const tracePath = join(this.runDir, 'rifty-trace.json');
    writeFileSync(tracePath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');
    const metadata = await this.page.evaluate(() =>
      (
        globalThis as typeof globalThis & {
          __riftyAgentBench: { sessionMetadata(): unknown };
        }
      ).__riftyAgentBench.sessionMetadata(),
    );
    const metadataPath = join(this.runDir, 'rifty-session-metadata.json');
    writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    this.cachedLaneTrace = traceToLaneTrace(
      trace,
      {
        trace: tracePath,
        sessionMetadata: metadataPath,
        playgroundConsole: join(this.runDir, 'playground-console.log'),
      },
      this.harnessBudgetReason,
    );
    return this.cachedLaneTrace;
  }

  async terminalTail(): Promise<string> {
    return renderTraceTerminal(await this.exportTrace());
  }

  async gitDiff(): Promise<string> {
    return renderFinalDiff((await this.exportTrace()).finalDiff);
  }

  async readFile(relPath: string): Promise<string> {
    // Judge-facing full-byte owner read (ADR-0191 hook) — same bridge as file
    // downloads, never the capped page snapshot.
    return this.page.evaluate(
      (rel) =>
        (
          globalThis as typeof globalThis & {
            __riftyAgentBench: { readFile(relPath: string): Promise<string> };
          }
        ).__riftyAgentBench.readFile(rel),
      relPath,
    );
  }

  async createJudgePage(): Promise<JudgePageHandle> {
    // Same context: the SW + workspace owner serving /preview/<port>/ live in
    // THIS context; a foreign browser would see nothing at that URL.
    const page = await this.context.newPage();
    return { page, close: () => page.close() };
  }

  async cleanup(): Promise<void> {
    await this.context.close();
  }
}

// ── lane adapter ─────────────────────────────────────────────────────────────

export function createRiftyLane(config: BenchConfig): LaneAdapter {
  const endpoint = config.endpoint;
  if (endpoint === null) {
    throw new Error(
      'agent-bench: lane rifty needs an endpoint — provide `endpoint` in the config file or pass --mock-model',
    );
  }
  const playgroundPort = config.playgroundPort;
  const playgroundUrl = `http://localhost:${playgroundPort}/`;
  let browser: Browser | null = null;
  let playground: ChildProcess | null = null;

  async function ensureBrowser(): Promise<Browser> {
    if (browser === null) browser = await chromium.launch();
    return browser;
  }

  /** Reuse a listening playground (root webServer semantics) or spawn one. */
  async function ensurePlayground(logPath: string): Promise<void> {
    if (playground !== null || (await isHttpUp(playgroundUrl))) return;
    playground = spawnLoggedServer('pnpm', ['--filter', '@riftydev/playground', 'dev'], {
      cwd: REPO_ROOT,
      env: { ...process.env, RIFTY_PLAYGROUND_PORT: String(playgroundPort) },
      logPath,
      detached: true, // kill the pnpm wrapper AND its vite child on dispose
    });
    await waitHttpReady(playgroundUrl, PLAYGROUND_READY_TIMEOUT_MS, 'playground dev server');
  }

  return {
    id: 'rifty',
    promptProfile: RIFTY_PROMPT_PROFILE,

    async laneVersions(): Promise<Record<string, string>> {
      return {
        model: endpoint.model,
        promptProfile: RIFTY_PROMPT_PROFILE,
        playground: `http://localhost:${playgroundPort}`,
        chromium: (await ensureBrowser()).version(),
      };
    },

    async prepare(task: BenchTask, runDir: string): Promise<PreparedRun> {
      mkdirSync(runDir, { recursive: true });
      await ensurePlayground(join(runDir, 'playground-dev.log'));

      const apiKey = process.env[endpoint.envKey];
      if (apiKey === undefined || apiKey === '') {
        throw new Error(
          `agent-bench: env var ${endpoint.envKey} (endpoint.envKey) is not set — the rifty lane seeds it into the session settings`,
        );
      }

      const context = await (await ensureBrowser()).newContext();
      const page = await context.newPage();
      const consoleLog = join(runDir, 'playground-console.log');
      writeFileSync(consoleLog, '', 'utf8');
      page.on('console', (msg) => {
        if (msg.type() === 'error' || msg.type() === 'warning') {
          appendFileSync(consoleLog, `[console.${msg.type()}] ${msg.text()}\n`, 'utf8');
        }
      });
      page.on('pageerror', (err) =>
        appendFileSync(consoleLog, `[pageerror] ${err.message}\n`, 'utf8'),
      );

      try {
        // Settings pre-seed BEFORE navigation — what a human enters in the
        // settings dialog; the key exists only inside this ephemeral context.
        const settings = riftyAiSettings(endpoint, config.limits, apiKey);
        await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [
          AI_SETTINGS_KEY,
          JSON.stringify(settings),
        ] as [string, string]);

        // Cold boot straight into the task's preset with the bench flag.
        await page.goto(`${playgroundUrl}?preset=${task.templateId}&agentBench=1&autorun=1`, {
          waitUntil: 'load',
          timeout: 60_000,
        });
        await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
          timeout: 30_000,
        });
        await page
          .locator('.rf-app[data-workspace-owner="workspace"]')
          .waitFor({ state: 'visible', timeout: BOOT_TIMEOUT_MS });
        // Dev server LIVE pill = preview actually serving (helpers/playground.ts pattern).
        const devPort = templateSpec(task.templateId).defaultPort;
        await page
          .getByText(`LIVE :${devPort}`, { exact: true })
          .first()
          .waitFor({ state: 'visible', timeout: BOOT_TIMEOUT_MS });

        // Task seed overlay through the acked hook (ADR-0191).
        const seed = benchSeedFiles(task);
        if (Object.keys(seed).length > 0) {
          await page.evaluate(
            (files) =>
              (
                globalThis as typeof globalThis & {
                  __riftyAgentBench: { seed(f: Record<string, string>): Promise<void> };
                }
              ).__riftyAgentBench.seed(files),
            seed,
          );
        }

        // Open AI mode via the real toggle (lazy-loads the ai module).
        await page.click('[data-testid="ai-toggle"]');
        await page
          .locator('[data-testid="ai-panel"]')
          .waitFor({ state: 'visible', timeout: 30_000 });

        return new RiftyPreparedRun({
          context,
          page,
          task,
          runDir,
          limits: config.limits,
          playgroundPort,
        });
      } catch (err) {
        await context.close();
        throw err;
      }
    },

    async dispose(): Promise<void> {
      if (browser !== null) await browser.close();
      browser = null;
      await killProcessGroup(playground);
      playground = null;
    },
  };
}
