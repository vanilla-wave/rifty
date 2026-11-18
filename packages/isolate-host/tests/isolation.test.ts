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
        await probe('binding', () => { const b = process.binding('fs'); return b && (typeof b.open === 'function' || typeof b.readFileUtf8 === 'function') ? ${JSON.stringify(hosts)} : 'no'; });
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

  it('no reachable value or bridge function yields the child realm or an isolated-vm handle', async () => {
    const before = new Set(childPids());
    const running = runCode(String.raw`
      const leaks = [];
      // isolated-vm handle methods (Reference/ExternalCopy); not WeakRef's plain 'deref'.
      const IVM = ['applySync', 'applyIgnored', 'applySyncPromise', 'derefInto', 'copySync', 'copyInto', 'getSync', 'setSync'];
      const realmOf = (f) => {
        try { return f.constructor.constructor('return this')(); } catch { return globalThis; }
      };
      const check = (v, path) => {
        if (typeof v === 'function') {
          const g = realmOf(v);
          if (g !== globalThis) leaks.push('realm ' + path);
          else {
            try {
              const p = g.process;
              if (p !== process) leaks.push('process ' + path);
            } catch {}
          }
        }
        if ((typeof v === 'object' && v !== null) || typeof v === 'function') {
          for (const m of IVM) {
            try { if (m in v && typeof v[m] === 'function') leaks.push('ivm ' + m + ' ' + path); } catch {}
          }
        }
      };
      const seen = new Set();
      const walk = (v, path, depth) => {
        if (v === null || (typeof v !== 'object' && typeof v !== 'function') || seen.has(v) || depth > 7) return;
        seen.add(v);
        check(v, path);
        let keys = [];
        try { keys = Reflect.ownKeys(v); } catch {}
        for (const k of keys) {
          let d;
          try { d = Reflect.getOwnPropertyDescriptor(v, k); } catch { continue; }
          if (!d) continue;
          const name = path + '.' + String(k);
          if ('value' in d) walk(d.value, name, depth + 1);
          if (d.get) walk(d.get, name + '<get>', depth + 1);
          if (d.set) walk(d.set, name + '<set>', depth + 1);
        }
        try { walk(Object.getPrototypeOf(v), path + '.__proto__', depth + 1); } catch {}
      };
      // Intercept every function that flows through call/apply/bind/Reflect while
      // the bridge is exercised (timers, stdio, crypto, performance, codec).
      const flowed = new Set();
      const FP = Function.prototype;
      const { call, apply, bind } = FP;
      const rApply = Reflect.apply;
      const rConstruct = Reflect.construct;
      FP.call = function (...a) { flowed.add(this); return rApply(call, this, a); };
      FP.apply = function (...a) { flowed.add(this); return rApply(apply, this, a); };
      FP.bind = function (...a) { flowed.add(this); return rApply(bind, this, a); };
      Reflect.apply = (f, t, a) => { flowed.add(f); return rApply(f, t, a); };
      Reflect.construct = (f, a, n) => { flowed.add(f); return rConstruct(f, a, n); };
      process.stdout.write('');
      process.stderr.write('');
      crypto.getRandomValues(new Uint8Array(4));
      performance.now();
      new TextDecoder().decode(new TextEncoder().encode('x'));
      setTimeout(() => {
        clearTimeout(setTimeout(() => {}, 5));
        setImmediate(() => {
          FP.call = call; FP.apply = apply; FP.bind = bind; Reflect.apply = rApply; Reflect.construct = rConstruct;
          walk(globalThis, 'globalThis', 0);
          for (const f of flowed) check(f, 'flowed:' + (f && f.name));
          console.log(JSON.stringify({ pid: process.pid, walked: seen.size, leaks }));
          setTimeout(() => {}, 800);
        });
      }, 10);
    `);
    running.catch(() => {}); // asserted below; keeps an early failure from going unhandled
    const childPid = await waitFor(() => childPids().find((p) => !before.has(p)), 1000);
    const result = await running;
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const report = JSON.parse(result.stdout) as { pid: number; walked: number; leaks: string[] };
    expect(report.leaks).toEqual([]);
    expect(report.pid).not.toBe(childPid);
    expect(report.walked).toBeGreaterThan(500);
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
    // Linux: the block is empty (the channel is plain pipes, so not even Node's NODE_CHANNEL_*).
    if (process.platform === 'linux') expect(environment).toBe('');
    await expect(running).resolves.toEqual({ stdout: 'done\n', stderr: '', exitCode: 0 });
  });
});
