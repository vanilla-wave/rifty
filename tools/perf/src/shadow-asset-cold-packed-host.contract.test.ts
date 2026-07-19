import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { hostOriginFromLine } from './shadow-asset-cold-packed-host.mjs';

const hostModuleUrl = new URL('./shadow-asset-cold-packed-host.mjs', import.meta.url).href;

interface ScenarioResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

function lifecycleScenario(runnerSource: string, body: string, options = ''): string {
  return `
    import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
    import { tmpdir } from 'node:os';
    import { join, resolve } from 'node:path';
    import { startPackedShadowAssetColdHost } from ${JSON.stringify(hostModuleUrl)};

    const repoRoot = await mkdtemp(join(tmpdir(), 'rifty-packed-host-contract-'));
    await mkdir(resolve(repoRoot, 'tests/integration'), { recursive: true });
    await writeFile(
      resolve(repoRoot, 'tests/integration/workbench-packed-consumer.mjs'),
      ${JSON.stringify(runnerSource)},
    );
    try {
      const host = await startPackedShadowAssetColdHost({
        repoRoot,
        env: process.env,
        ${options}
      });
      ${body}
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  `;
}

function runLifecycleScenario(source: string, timeoutMs = 2_000): Promise<ScenarioResult> {
  return new Promise((resolveScenario, rejectScenario) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', source], {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform === 'win32' || child.pid === undefined) child.kill('SIGKILL');
        else process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        const code = error instanceof Error && 'code' in error ? error.code : undefined;
        if (code !== 'ESRCH') rejectScenario(error);
      }
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      rejectScenario(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolveScenario({ code, signal, stderr, stdout, timedOut });
    });
  });
}

describe('packed shadow-asset cold host readiness', () => {
  it('ignores non-marker output and accepts one exact loopback origin marker', () => {
    expect(hostOriginFromLine('$ pnpm build')).toBeNull();
    expect(
      hostOriginFromLine('RIFTY_SHADOW_ASSET_COLD_HOST={"origin":"http://127.0.0.1:43127"}'),
    ).toBe('http://127.0.0.1:43127');
  });

  it.each([
    'RIFTY_SHADOW_ASSET_COLD_HOST=not-json',
    'RIFTY_SHADOW_ASSET_COLD_HOST={}',
    'RIFTY_SHADOW_ASSET_COLD_HOST={"origin":"data:text/plain,no"}',
  ])('rejects malformed readiness %s', (line) => {
    expect(() => hostOriginFromLine(line)).toThrow(/readiness|origin|http/i);
  });

  it('cancels the startup timeout after a ready host stops', async () => {
    const result = await runLifecycleScenario(
      lifecycleScenario(
        `
          console.log('RIFTY_SHADOW_ASSET_COLD_HOST={"origin":"http://127.0.0.1:43127"}');
          process.once('SIGTERM', () => process.exit(0));
          setInterval(() => {}, 1_000);
        `,
        `
          await host.stop();
          console.log('SCENARIO_OK');
        `,
      ),
    );

    expect(result, result.stderr).toMatchObject({ code: 0, timedOut: false });
    expect(result.stdout).toContain('SCENARIO_OK');
  });

  it('rejects an unexpected nonzero host exit after readiness', async () => {
    const result = await runLifecycleScenario(
      lifecycleScenario(
        `
          console.log('RIFTY_SHADOW_ASSET_COLD_HOST={"origin":"http://127.0.0.1:43127"}');
          setTimeout(() => process.exit(7), 20);
        `,
        `
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
          await host.stop().then(
            () => { throw new Error('stop accepted unexpected exit'); },
            (error) => {
              if (!/unexpected|code 7/i.test(String(error))) throw error;
            },
          );
          console.log('SCENARIO_OK');
        `,
      ),
    );

    expect(result, result.stderr).toMatchObject({ code: 0, timedOut: false });
    expect(result.stdout).toContain('SCENARIO_OK');
  });

  it.runIf(process.platform !== 'win32')(
    'terminates the packed host process group before stop resolves',
    async () => {
      const result = await runLifecycleScenario(
        lifecycleScenario(
          `
            import { spawn } from 'node:child_process';
            import { existsSync } from 'node:fs';
            import { resolve } from 'node:path';

            const readyPath = resolve(process.cwd(), 'nested-ready');
            spawn(
              process.execPath,
              [
                '--input-type=module',
                '--eval',
                \`import { writeFileSync } from 'node:fs';
                 process.on('SIGTERM', () => {});
                 writeFileSync(\${JSON.stringify(readyPath)}, 'ready');
                 setInterval(() => {}, 1_000);\`,
              ],
              { stdio: 'inherit' },
            );
            while (!existsSync(readyPath)) {
              await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
            }
            process.on('SIGTERM', () => {});
            console.log('RIFTY_SHADOW_ASSET_COLD_HOST={"origin":"http://127.0.0.1:43127"}');
            setInterval(() => {}, 1_000);
          `,
          `
            await host.stop();
            console.log('SCENARIO_OK');
          `,
          'startTimeoutMs: 1_000, stopTimeoutMs: 50, killTimeoutMs: 1_000,',
        ),
      );

      expect(result, result.stderr).toMatchObject({ code: 0, timedOut: false });
      expect(result.stdout).toContain('SCENARIO_OK');
    },
  );
});
