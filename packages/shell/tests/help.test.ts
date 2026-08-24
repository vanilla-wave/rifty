/**
 * `help` builtin — lists the LIVE registered command registry + per-command synopsis.
 */
import { describe, expect, it } from 'vitest';
import { Shell } from '../src/index.ts';
import type { CommandContext } from '../src/types.ts';

const noop: (args: string[], ctx: CommandContext) => Promise<number> = async () => 0;

describe('help builtin', () => {
  it('lists core builtins and notes node/npm/vite, exit 0', async () => {
    const sh = new Shell();
    const r = await sh.run('help');
    expect(r.exitCode).toBe(0);
    for (const cmd of ['cat', 'ls', 'grep', 'wc', 'help']) {
      expect(r.stdout).toContain(cmd);
    }
    expect(r.stdout).toMatch(/npm/);
    expect(r.stdout).toMatch(/vite/);
  });

  it('lists itself (help appears in its own output)', async () => {
    const sh = new Shell();
    const r = await sh.run('help');
    expect(r.stdout).toContain('help');
  });

  it('reflects custom-registered commands from the LIVE registry', async () => {
    const sh = new Shell();
    sh.registerCommand('frobnicate', noop);
    const r = await sh.run('help');
    expect(r.stdout).toContain('frobnicate');
  });

  it('help <known> prints a one-line synopsis, exit 0', async () => {
    const sh = new Shell();
    const r = await sh.run('help pwd');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/pwd/);
    expect(r.stdout.trim().split('\n').length).toBe(1); // one line
  });

  it('help <unknown> → no help topic, exit 1', async () => {
    const sh = new Shell();
    const r = await sh.run('help nonesuch');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("help: no help topic for 'nonesuch'");
  });
});
