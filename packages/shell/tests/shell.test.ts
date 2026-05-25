import { NotImplementedError } from '@rifty/io';
import type { FsSync } from '@rifty/vfs';
import { syncMirror } from '@rifty/vfs';
import { resetSyncMirror, setSyncMirror } from '@rifty/vfs/internal';
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

describe('tokenize — single vs double quotes', () => {
  it('single quotes are literal — $VAR is NOT expanded inside', () => {
    expect(tokenize("echo '$HOME'", { HOME: '/root' })).toEqual(['echo', '$HOME']);
  });

  it("single quotes don't honour backslash escapes", () => {
    // POSIX: inside `'…'` even \\ stays literal. The only character that
    // terminates the run is a closing `'`.
    expect(tokenize(String.raw`echo 'a\nb'`)).toEqual(['echo', String.raw`a\nb`]);
  });

  it('double quotes expand $VAR', () => {
    expect(tokenize('echo "$HOME"', { HOME: '/root' })).toEqual(['echo', '/root']);
  });

  it('double quotes expand ${VAR}', () => {
    expect(tokenize('echo "${USER}"', { USER: 'alice' })).toEqual(['echo', 'alice']);
  });

  it('double quotes preserve whitespace as one token even after expansion', () => {
    expect(tokenize('echo "$X end"', { X: 'a b c' })).toEqual(['echo', 'a b c end']);
  });

  it('double quotes honour limited backslash escapes', () => {
    expect(tokenize('echo "a\\$b"', { b: 'IGNORED' })).toEqual(['echo', 'a$b']);
    expect(tokenize('echo "a\\\\b"')).toEqual(['echo', 'a\\b']);
    expect(tokenize('echo "a\\"b"')).toEqual(['echo', 'a"b']);
  });

  it('unknown variables expand to empty string', () => {
    expect(tokenize('echo "[$NOPE]"')).toEqual(['echo', '[]']);
    expect(tokenize('echo $NOPE end')).toEqual(['echo', '', 'end']);
  });

  it('unquoted $VAR expands but stays one token (no IFS splitting)', () => {
    expect(tokenize('echo $X', { X: 'a b' })).toEqual(['echo', 'a b']);
  });

  it('adjacent quoted/unquoted segments concatenate into one token', () => {
    expect(tokenize('echo a"b"c')).toEqual(['echo', 'abc']);
    expect(tokenize("echo a'b'c")).toEqual(['echo', 'abc']);
  });

  it('${VAR:-default} and similar forms throw — unsupported, not silent', () => {
    expect(() => tokenize('echo ${X:-y}', { X: '' })).toThrow(/unsupported variable expansion/);
  });
});

describe('Shell — input redirect is loud', () => {
  it('throws NotImplementedError when < appears in a command line', async () => {
    const sh = new Shell();
    await expect(sh.run('cat < /etc/hostname')).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('the NotImplementedError carries the documented feature name', async () => {
    const sh = new Shell();
    await expect(sh.run('cat < /etc/hostname')).rejects.toMatchObject({
      feature: 'shell.input-redirect',
    });
  });
});

describe('Shell — pipe is loud', () => {
  it('tokenises | as its own token (not glued to an argument)', () => {
    // Without dedicated tokenisation `cat a | grep b` would silently become
    // ['cat', 'a', '|', 'grep', 'b'] only by accident if whitespace is right;
    // glued forms like `a|b` would otherwise be one token.
    expect(tokenize('cat a | grep b')).toEqual(['cat', 'a', '|', 'grep', 'b']);
    expect(tokenize('cat a|grep b')).toEqual(['cat', 'a', '|', 'grep', 'b']);
  });

  it('throws NotImplementedError when | appears in a command line', async () => {
    const sh = new Shell();
    await expect(sh.run('cat a | grep b')).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('the NotImplementedError for pipe carries the documented feature name', async () => {
    const sh = new Shell();
    await expect(sh.run('cat a | grep b')).rejects.toMatchObject({
      feature: 'shell.pipe',
    });
  });
});

describe('Shell — redirect write failure surfaces loudly', () => {
  it('returns exitCode != 0 with EREDIRECT-tagged stderr when the write fails', async () => {
    // Install a sync mirror whose writeFileSync throws — simulates a backend
    // that cannot persist (e.g. quota exceeded, read-only handle, …). The
    // shell must surface this as a non-zero exit + clear stderr line, not
    // silently swallow it.
    const failing: FsSync = {
      existsSync: () => false,
      readFileBytesSync: () => {
        throw new Error('no read');
      },
      writeFileSync: () => {
        throw new Error('boom: backend refused write');
      },
      readdirSync: () => [],
      mkdirSync: () => undefined,
      rmSync: () => undefined,
      statSync: () => ({ isFile: false, isDirectory: false }),
      utimes: () => undefined,
    };
    setSyncMirror(failing);
    const sh = new Shell({ cwd: '/' });
    const r = await sh.run('echo hello > /tmp/out.txt');
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/redirect write failed/);
    expect(r.stderr).toMatch(/EREDIRECT/);
    expect(r.stderr).toMatch(/boom: backend refused write/);
    // The buffered stdout must NOT be dumped onto stdout — it was meant for
    // a file, not the console.
    expect(r.stdout).toBe('');
  });
});

describe('Shell — env expansion in run()', () => {
  it('$VAR in arguments expands from the shell env', async () => {
    const sh = new Shell({ env: { GREETING: 'hello there' } });
    const r = await sh.run('echo "$GREETING"');
    expect(r.stdout).toBe('hello there\n');
  });
});

describe('touch — mtime is updated for existing files', () => {
  it('bumps mtime on each subsequent touch', async () => {
    const sh = new Shell({ cwd: '/' });
    const create = await sh.run('touch /file.txt');
    expect(create.exitCode).toBe(0);
    const first = syncMirror().statSync('/file.txt').mtime!;

    // Second touch — mtime must move strictly forward, regardless of whether
    // Date.now() ticks between calls.
    const second = await sh.run('touch /file.txt');
    expect(second.exitCode).toBe(0);
    const afterSecond = syncMirror().statSync('/file.txt').mtime!;
    expect(afterSecond).toBeGreaterThan(first);

    const third = await sh.run('touch /file.txt');
    expect(third.exitCode).toBe(0);
    const afterThird = syncMirror().statSync('/file.txt').mtime!;
    expect(afterThird).toBeGreaterThan(afterSecond);
  });

  it('touch still creates a new file when path does not exist', async () => {
    const sh = new Shell({ cwd: '/' });
    const r = await sh.run('touch /new-file');
    expect(r.exitCode).toBe(0);
    expect(syncMirror().existsSync('/new-file')).toBe(true);
  });
});
