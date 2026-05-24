import { resetSyncMirror } from '@rifty/vfs';
/**
 * Unit tests for `@rifty/shell` — tokenizer, builtins, dispatch.
 *
 * The shell is intentionally bash-flavoured but not bash. It supports just
 * enough to drive `npm install`, `npm run dev`, and basic file ops in the
 * playground terminal (M10).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Shell, tokenize } from '../src/index.ts';

afterEach(() => {
  resetSyncMirror();
});

describe('tokenize', () => {
  it('splits a simple command on whitespace', () => {
    expect(tokenize('ls -la /tmp')).toEqual(['ls', '-la', '/tmp']);
  });

  it('preserves quoted segments', () => {
    expect(tokenize('echo "hello world" yes')).toEqual(['echo', 'hello world', 'yes']);
    expect(tokenize("echo 'a b' c")).toEqual(['echo', 'a b', 'c']);
  });

  it('returns an empty array for an empty line', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });

  it('does not split arg=value', () => {
    expect(tokenize('FOO=bar baz')).toEqual(['FOO=bar', 'baz']);
  });
});

describe('Shell — builtins', () => {
  it('pwd prints the current directory', async () => {
    const sh = new Shell({ cwd: '/workspace' });
    const r = await sh.run('pwd');
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('/workspace');
  });

  it('cd changes cwd; pwd reflects it', async () => {
    const sh = new Shell({ cwd: '/' });
    await sh.run('mkdir -p /a/b');
    const r1 = await sh.run('cd /a/b');
    expect(r1.exitCode).toBe(0);
    const r2 = await sh.run('pwd');
    expect(r2.stdout.trim()).toBe('/a/b');
  });

  it('cd to a nonexistent directory errors', async () => {
    const sh = new Shell({ cwd: '/' });
    const r = await sh.run('cd /nope');
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/no such file|ENOENT/i);
  });

  it('echo prints joined args + newline', async () => {
    const sh = new Shell();
    const r = await sh.run('echo hello world');
    expect(r.stdout).toBe('hello world\n');
  });

  it('mkdir + ls + cat round trip', async () => {
    const sh = new Shell({ cwd: '/' });
    await sh.run('mkdir -p /tmp/x');
    await sh.run('cd /tmp/x');
    // No quoted heredocs — we use `echo > file` redirection.
    const w = await sh.run('echo "hi there" > greeting.txt');
    expect(w.exitCode).toBe(0);
    const ls = await sh.run('ls');
    expect(ls.stdout.trim()).toBe('greeting.txt');
    const cat = await sh.run('cat greeting.txt');
    expect(cat.stdout).toBe('hi there\n');
  });

  it('rm -r deletes a directory recursively', async () => {
    const sh = new Shell({ cwd: '/' });
    await sh.run('mkdir -p /trash/inner');
    await sh.run('echo x > /trash/inner/a');
    const r = await sh.run('rm -r /trash');
    expect(r.exitCode).toBe(0);
    const ls = await sh.run('ls /');
    expect(ls.stdout).not.toMatch(/trash/);
  });

  it('reports unknown command with exit code 127', async () => {
    const sh = new Shell();
    const r = await sh.run('foobarbaz');
    expect(r.exitCode).toBe(127);
    expect(r.stderr).toMatch(/foobarbaz/);
  });
});

describe('Shell — custom command registration', () => {
  it('routes a registered command and returns its exit code', async () => {
    const sh = new Shell();
    sh.registerCommand('greet', async (args, ctx) => {
      ctx.stdout.write(`hi, ${args.join(' ')}\n`);
      return 0;
    });
    const r = await sh.run('greet alice bob');
    expect(r.stdout).toBe('hi, alice bob\n');
    expect(r.exitCode).toBe(0);
  });

  it('exposes the shell cwd to the command context', async () => {
    const sh = new Shell({ cwd: '/workdir' });
    let seenCwd = '';
    sh.registerCommand('where', async (_args, ctx) => {
      seenCwd = ctx.cwd;
      return 0;
    });
    await sh.run('where');
    expect(seenCwd).toBe('/workdir');
  });
});
