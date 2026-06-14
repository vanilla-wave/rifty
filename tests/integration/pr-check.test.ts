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

// signals SELF, then blocks until OTHER appears — only exits 0 if a peer runs concurrently
const rendezvous = (self: string, other: string) =>
  `const fs=require('fs');fs.writeFileSync(${JSON.stringify(self)},'1');` +
  `const d=Date.now()+3000;while(!fs.existsSync(${JSON.stringify(other)})){if(Date.now()>d)process.exit(1);}process.exit(0);`;

describe('runChecks', () => {
  it('reports each task exit code and ok=false when any fails', async () => {
    const { results, ok: pass } = await runChecks([ok('a'), fail('b', 3)], { jobs: 2 });
    expect(pass).toBe(false);
    expect(results.find((r) => r.name === 'a')?.code).toBe(0);
    expect(results.find((r) => r.name === 'b')?.code).toBe(3);
  });

  it('ok=true when every task passes', async () => {
    expect((await runChecks([ok('a'), ok('b')], { jobs: 2 })).ok).toBe(true);
  });

  it('captures stdout and stderr of each task', async () => {
    const { results } = await runChecks(
      [{ name: 'e', command: node, args: ['-e', 'console.log("OUT");console.error("ERR")'] }],
      { jobs: 1 },
    );
    expect(results[0].output).toContain('OUT');
    expect(results[0].output).toContain('ERR');
  });

  it('runs tasks concurrently up to the job limit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pc-'));
    tmps.push(dir);
    const a = join(dir, 'a');
    const b = join(dir, 'b');
    const tasks = [
      { name: 'A', command: node, args: ['-e', rendezvous(a, b)] },
      { name: 'B', command: node, args: ['-e', rendezvous(b, a)] },
    ];
    // serial execution would deadlock the first task to its 3s timeout (exit 1)
    expect((await runChecks(tasks, { jobs: 2 })).ok).toBe(true);
  });
});
