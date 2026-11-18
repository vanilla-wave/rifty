/**
 * I2 fresh instance per call, I3 no host reach (goal isolate-host-run-code,
 * scenario steps 3–4). Real children, real isolates; canaries live in this
 * (the consumer) process.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCode } from '../src/index.ts';
import { childPids, processCommand, processEnvironment, waitFor } from './support.ts';

const GLOBAL_CANARY = 'RIFTY_HOST_GLOBAL_CANARY';
const ENV_CANARY = 'RIFTY_HOST_ENV_CANARY';
const SECRET = 'host-secret-7f3a91';

beforeAll(() => {
  (globalThis as Record<string, unknown>)[GLOBAL_CANARY] = SECRET;
  process.env[ENV_CANARY] = SECRET;
});
afterAll(() => {
  delete (globalThis as Record<string, unknown>)[GLOBAL_CANARY];
  delete process.env[ENV_CANARY];
});

describe('fresh instance per call (I2)', () => {
  it('a file, a global and a pending timer of one call are absent from the next', async () => {
    const first = await runCode(
      "require('fs').writeFileSync('state.txt', 'x'); globalThis.leaked = 1; setTimeout(() => console.log('LATE'), 150); console.log('first'); process.exit(0)",
    );
    expect(first).toEqual({ stdout: 'first\n', stderr: '', exitCode: 0 });
    const second = await runCode(
      "setTimeout(() => console.log(require('fs').existsSync('state.txt'), typeof globalThis.leaked), 300)",
    );
    expect(second).toEqual({ stdout: 'false undefined\n', stderr: '', exitCode: 0 });
  });

  it('no child process outlives its result', async () => {
    await runCode("console.log('x')");
    expect(childPids()).toEqual([]);
  });
});

describe('no host reach (I3)', () => {
  it('host globalThis and env canaries are not observable', async () => {
    const result = await runCode(`
      const names = Object.getOwnPropertyNames(globalThis);
      console.log(typeof globalThis.${GLOBAL_CANARY}, names.includes('${GLOBAL_CANARY}'));
      console.log(JSON.stringify(process.env), process.env.${ENV_CANARY});
      console.log(JSON.stringify(names.map((n) => { try { return String(globalThis[n]) } catch { return '' } })).includes('${SECRET}'));
    `);
    expect(result).toEqual({
      stdout: 'undefined false\n{} undefined\nfalse\n',
      stderr: '',
      exitCode: 0,
    });
  });

  it('the guest realm holds no Node primitive', async () => {
    const hosts = readFileSync('/etc/hosts', 'utf8');
    const result = await runCode(`
      const out = [];
      const probe = async (label, f) => { try { const v = await f(); out.push(label + ':' + (typeof v === 'string' && v === ${JSON.stringify(hosts)} ? 'LEAK' : 'no')); } catch (e) { out.push(label + ':blocked'); } };
      (async () => {
        await probe('import', async () => (await (0, eval)("import('node:fs')")).readFileSync('/etc/hosts', 'utf8'));
        await probe('getBuiltinModule', () => process.getBuiltinModule('node:fs').readFileSync('/etc/hosts', 'utf8'));
        await probe('require', () => require('fs').readFileSync('/etc/hosts', 'utf8'));
        await probe('binding', () => process.binding('fs'));
        await probe('Function', () => Function('return typeof process.dlopen')() === 'function' ? ${JSON.stringify(hosts)} : 'no');
        console.log(out.join(' '));
      })();
    `);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('LEAK');
    expect(result.stdout).toMatch(
      /^import:\w+ getBuiltinModule:\w+ require:\w+ binding:\w+ Function:\w+\n$/,
    );
  });

  it('the process hosting the isolate carries no inherited host environment', async () => {
    const before = new Set(childPids());
    const running = runCode("setTimeout(() => console.log('done'), 1500)");
    running.catch(() => {}); // asserted below; keeps an early failure from going unhandled
    const pid = await waitFor(() => childPids().find((p) => !before.has(p)), 1000);
    expect(processCommand(pid)).toContain('--no-node-snapshot');
    const environment = processEnvironment(pid);
    expect(environment).not.toContain(SECRET);
    expect(environment).not.toContain(ENV_CANARY);
    if (process.platform === 'linux') expect(environment).toBe('');
    await expect(running).resolves.toEqual({ stdout: 'done\n', stderr: '', exitCode: 0 });
  });
});
