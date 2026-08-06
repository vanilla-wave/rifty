import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runChecks } from '../../tools/checks/pr-check.mjs';

const node = process.execPath;
const ok = (name: string) => ({ name, command: node, args: ['-e', 'process.exit(0)'] });
const fail = (name: string, code: number) => ({
  name,
  command: node,
  args: ['-e', `process.exit(${code})`],
});

const tmps: string[] = [];
afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

describe('runChecks', () => {
  it('reports each task exit code and ok=false when any fails', async () => {
    const { results, ok: pass } = await runChecks([ok('a'), fail('b', 3)]);
    expect(pass).toBe(false);
    expect(results.find((r) => r.name === 'a')?.code).toBe(0);
    expect(results.find((r) => r.name === 'b')?.code).toBe(3);
  });

  it('ok=true when every task passes', async () => {
    expect((await runChecks([ok('a'), ok('b')])).ok).toBe(true);
  });

  it('captures stdout and stderr of each task', async () => {
    const { results } = await runChecks([
      { name: 'e', command: node, args: ['-e', 'console.log("OUT");console.error("ERR")'] },
    ]);
    expect(results[0].output).toContain('OUT');
    expect(results[0].output).toContain('ERR');
  });

  it('runs tasks one at a time in declaration order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pc-serial-'));
    tmps.push(dir);
    const first = join(dir, 'first');
    const tasks = [
      {
        name: 'first',
        command: node,
        args: [
          '-e',
          `setTimeout(()=>{require('fs').writeFileSync(${JSON.stringify(first)},'1');process.exit(0)},100)`,
        ],
      },
      // exits 0 only if `first` already finished — a concurrent pool starts it too early
      {
        name: 'second',
        command: node,
        args: ['-e', `process.exit(require('fs').existsSync(${JSON.stringify(first)})?0:1)`],
      },
    ];
    const { results, ok: pass } = await runChecks(tasks);
    expect(pass).toBe(true);
    expect(results.map((r) => r.name)).toEqual(['first', 'second']);
  });
});
