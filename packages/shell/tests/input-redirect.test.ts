/**
 * Shell input redirect (`cmd < file`) — feeds a VFS file as the stage's stdin,
 * mirroring the `>`/`>>` extraction; composes with pipes.
 */
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { Shell } from '../src/index.ts';

afterEach(() => resetSyncMirror());

async function seed(sh: Shell): Promise<void> {
  await sh.run('echo alpha > /a.txt');
  await sh.run('echo beta >> /a.txt');
  await sh.run('echo gamma >> /a.txt');
  await sh.run('echo "beta two" >> /a.txt');
}

describe('Shell — input redirect (< file)', () => {
  it('wc -l < file → line count (no filename column)', async () => {
    const sh = new Shell({ cwd: '/' });
    await seed(sh);
    const r = await sh.run('wc -l < /a.txt');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('4\n');
  });

  it('grep < file → matching lines', async () => {
    const sh = new Shell({ cwd: '/' });
    await seed(sh);
    const r = await sh.run('grep beta < /a.txt');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('beta\nbeta two\n');
  });

  it('cat < file → file contents verbatim', async () => {
    const sh = new Shell({ cwd: '/' });
    await seed(sh);
    const r = await sh.run('cat < /a.txt');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('alpha\nbeta\ngamma\nbeta two\n');
  });

  it('a missing redirect file → error + exit 1, command does not run', async () => {
    const sh = new Shell({ cwd: '/' });
    const r = await sh.run('wc -l < /missing.txt');
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('/missing.txt');
    expect(r.stderr).toContain('No such file or directory');
  });

  it('redirect + pipe compose: grep < file | wc -l', async () => {
    const sh = new Shell({ cwd: '/' });
    await seed(sh);
    const r = await sh.run('grep beta < /a.txt | wc -l');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('2\n');
  });

  it('a relative redirect resolves against cwd', async () => {
    const sh = new Shell({ cwd: '/' });
    await sh.run('mkdir -p /w');
    await sh.run('cd /w');
    await sh.run('echo one > data.txt');
    await sh.run('echo two >> data.txt');
    const r = await sh.run('wc -l < data.txt');
    expect(r.stdout).toBe('2\n');
  });
});
