import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { loadConfig } from './config.ts';

it('resolves an explicit native Codex reference separately from the Pi model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rifty-codex-plan-'));
  try {
    const config = await loadConfig('tools/agent-bench/configs/gpt-6-luna.json');
    const codex = { model: 'gpt-6.1-sol', reasoning: 'low' };
    const path = join(root, 'config.json');
    await writeFile(path, JSON.stringify({ ...config, codex }));
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        resolve('tools/agent-bench/src/cli.ts'),
        'plan',
        '--config',
        path,
        '--task',
        'fix-date-sort',
        '--lane',
        'native-codex',
        '--runs',
        '1',
      ],
      { encoding: 'utf8', timeout: 30000 },
    );
    expect(result.status, result.stderr).toBe(0);
    const plan = JSON.parse(result.stdout) as {
      config: { endpoint: { id: string }; codex: typeof codex };
      trials: { task: string; lane: string; runIndex: number }[];
    };
    expect(plan.config.codex).toEqual(codex);
    expect(plan.config.endpoint.id).toBe('gpt-6-luna');
    expect(plan.trials).toEqual([{ task: 'fix-date-sort', lane: 'native-codex', runIndex: 1 }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
