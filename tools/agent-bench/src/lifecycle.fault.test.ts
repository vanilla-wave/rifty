import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { expect, it } from 'vitest';
import { catalogEndpoint } from '../tests/catalog-endpoint.ts';
import { lifecycleTask } from '../tests/lifecycle-task.ts';
import { prepareLocal } from './lanes/local-reference.ts';
import { killProcessGroup } from './proc.ts';
import type { Report } from './report.ts';
import { deriveStatistics } from './statistics.ts';

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  for (const phase of ['setup', 'judge'])
    it(`retains the started attempt on real ${signal} during ${phase}`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'rifty-series-signal-'));
      const output = join(root, 'series');
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', resolve('tools/agent-bench/tests/series-signal.ts'), output, phase],
        { stdio: ['ignore', 'pipe', 'pipe'], detached: true },
      );
      let diagnostic = '';
      child.stdout.on('data', (data) => {
        diagnostic += String(data);
      });
      child.stderr.on('data', (data) => {
        diagnostic += String(data);
      });
      const exit = new Promise((resolve) => child.once('close', resolve));
      try {
        await expect
          .poll(async () => readFile(join(output, 'ready'), 'utf8').catch(() => diagnostic), {
            timeout: 30000,
          })
          .toBe(phase);
        child.kill(signal);
        expect(await exit, diagnostic).toBe(0);
        const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8')) as Report;
        expect(report.header.series).toMatchObject({ status: 'interrupted' });
        expect(report.runs).toHaveLength(1);
        expect(report.runs[0]).toMatchObject({
          task: 'lifecycle',
          lane: 'local-reference',
          runIndex: 1,
          stage: phase,
          outcome: 'fail',
        });
        expect(report.runs[0]!.attemptStartedAt).toBeTruthy();
        expect(report.runs[0]!.completedAt).toBeUndefined();
        expect(report.runs[0]).toHaveProperty('interruptedAt', expect.any(String));
        expect(report.runs[0]!.error).toBeTruthy();
        expect(
          JSON.parse(
            await readFile(join(output, 'lifecycle/local-reference/1/failure.json'), 'utf8'),
          ),
        ).toMatchObject({ stage: phase });
        const stats = deriveStatistics({
          ...report,
          header: { ...report.header, purpose: 'quality' },
        });
        expect(stats).toMatchObject({ retainedTrials: 1, missingTrials: 0, interruptedTrials: 1 });
        expect(stats.cells[0]).toMatchObject({ ordinaryFailures: 0, passRate: null });
        expect(await readFile(join(output, 'summary.md'), 'utf8')).toMatch(
          /\| lifecycle \| local-reference \| 1 \| interrupted \|/,
        );
      } finally {
        await killProcessGroup(child);
        const workspace = await readFile(join(output, 'workspace-path'), 'utf8').catch(() => '');
        if (workspace) await rm(workspace, { recursive: true, force: true });
        await rm(root, { recursive: true, force: true });
      }
    }, 60000);

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  it(`preserves observed PASS when ${signal} arrives during cleanup`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'rifty-series-cleanup-signal-'));
    const output = join(root, 'series');
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        resolve('tools/agent-bench/tests/series-signal.ts'),
        output,
        'cleanup',
        signal,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], detached: true },
    );
    let diagnostic = '';
    child.stderr.on('data', (data) => {
      diagnostic += String(data);
    });
    try {
      const code = await new Promise((resolve) => child.once('close', resolve));
      expect(code, diagnostic).toBe(0);
      const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8')) as Report;
      expect(report.header.series?.status).toBe('interrupted');
      expect(report.runs).toHaveLength(1);
      expect(report.runs[0]).toMatchObject({ outcome: 'pass', judge: { pass: true } });
      expect(report.runs[0]!.completedAt).toBeTruthy();
      expect(report.runs[0]).not.toHaveProperty('interruptedAt');
      const stats = deriveStatistics({
        ...report,
        header: { ...report.header, purpose: 'quality' },
      });
      expect(stats).toMatchObject({ retainedTrials: 1, missingTrials: 0 });
      expect(stats).not.toHaveProperty('interruptedTrials');
      expect(stats.cells[0]).toMatchObject({ passes: 1, passRate: 1 });
    } finally {
      await killProcessGroup(child);
      const workspace = await readFile(join(output, 'workspace-path'), 'utf8').catch(() => '');
      if (workspace) await rm(workspace, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  }, 60000);

for (const phase of ['close', 'setup'])
  it(`reaps the real native preview after context.close rejects during ${phase}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rifty-native-close-'));
    const browser = await chromium.launch();
    const task = lifecycleTask();
    let workspace: string | undefined;
    let serverPid: number | undefined;
    const contexts = browser.newContext.bind(browser);
    browser.newContext = async (...args) => {
      const context = await contexts(...args);
      if (phase === 'setup') {
        context.newPage = async () => {
          throw new Error('injected page acquisition failure');
        };
      }
      context.close = async () => {
        throw new Error('injected context close failure');
      };
      return context;
    };
    // The preview writes its PID before the browser boundary can fail.
    task.files['src/main.js'] = `import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(join(dir, 'server-pid'))}, String(process.pid));
writeFileSync(${JSON.stringify(join(dir, 'workspace-path'))}, process.cwd());
createServer((_request, response) => response.end(String(process.pid)))
  .listen(Number(process.env.PORT), '127.0.0.1');`;
    try {
      const endpoint = catalogEndpoint('http://127.0.0.1:1/v1');
      const pending = prepareLocal({
        browser,
        task,
        endpoint,
        config: {
          endpoint,
          limits: { maxToolCalls: 1, runTimeoutMs: 60000 },
          runsPerTask: 1,
          playgroundPort: 5289,
        },
        dir,
        playgroundUrl: '',
      });
      if (phase === 'setup') {
        await expect(pending).rejects.toThrow('injected context close failure');
      } else {
        const prepared = await pending;
        workspace = prepared.workspace;
        await expect(prepared.close()).rejects.toThrow('injected context close failure');
      }
      serverPid = Number(await readFile(join(dir, 'server-pid'), 'utf8'));
      expect(() => process.kill(serverPid!, 0)).toThrow();
    } finally {
      workspace ??= await readFile(join(dir, 'workspace-path'), 'utf8').catch(() => undefined);
      serverPid ??= Number(await readFile(join(dir, 'server-pid'), 'utf8').catch(() => '0'));
      if (serverPid) {
        try {
          process.kill(-serverPid, 'SIGKILL');
        } catch {}
      }
      await browser.close();
      await rm(dir, { recursive: true, force: true });
      if (workspace) await rm(workspace, { recursive: true, force: true });
    }
  }, 60000);
