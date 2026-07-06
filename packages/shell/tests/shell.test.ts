import { NotImplementedError } from '@riftydev/io';
import type { FsSync } from '@riftydev/vfs';
import { syncMirror } from '@riftydev/vfs';
import { resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
/**
 * Unit tests for `@riftydev/shell` — tokenizer, builtins, dispatch.
 *
 * The shell is intentionally bash-flavoured but not bash. It supports just
 * enough to drive `npm install`, `npm run dev`, and basic file ops in the
 * playground terminal (M10).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Shell, type Token, coreCommandNames, tokenize } from '../src/index.ts';

afterEach(() => {
  resetSyncMirror();
});

/**
 * Project a `Token[]` to its word/op string sequence — the exact value contract
 * the pre-ADR-0091 `string[]` assertions encoded. The new quote-provenance bit
 * is covered separately in `tokenize-provenance.test.ts`; here we preserve the
 * original assertions verbatim (mechanical adaptation to the new return type,
 * NOT a weakening — CLAUDE.md).
 */
const vals = (tokens: Token[]): string[] => tokens.map((t) => ('op' in t ? t.op : t.value));

describe('tokenize', () => {
  it('splits a simple command on whitespace', () => {
    expect(vals(tokenize('ls -la /tmp'))).toEqual(['ls', '-la', '/tmp']);
  });

  it('preserves quoted segments', () => {
    expect(vals(tokenize('echo "hello world" yes'))).toEqual(['echo', 'hello world', 'yes']);
    expect(vals(tokenize("echo 'a b' c"))).toEqual(['echo', 'a b', 'c']);
  });

  it('returns an empty array for an empty line', () => {
    expect(vals(tokenize(''))).toEqual([]);
    expect(vals(tokenize('   '))).toEqual([]);
  });

  it('does not split arg=value', () => {
    expect(vals(tokenize('FOO=bar baz'))).toEqual(['FOO=bar', 'baz']);
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

  it('suggests a close builtin typo without changing exit 127', async () => {
    const sh = new Shell();
    const r = await sh.run('grpe needle file.txt');
    expect(r.exitCode).toBe(127);
    expect(r.stderr).toContain('grpe: command not found');
    expect(r.stderr).toContain("Did you mean 'grep'?");
  });

  it('suggests close custom registered commands', async () => {
    const sh = new Shell();
    sh.registerCommand('greet', async () => 0);
    const r = await sh.run('gret alice');
    expect(r.exitCode).toBe(127);
    expect(r.stderr).toContain("Did you mean 'greet'?");
  });

  it('does not suggest for distant unknown commands', async () => {
    const sh = new Shell();
    const r = await sh.run('zzzzzzzz');
    expect(r.exitCode).toBe(127);
    expect(r.stderr).toBe('zzzzzzzz: command not found\n');
  });

  it('suppresses the fuzzy suggestion for denylisted external tools', async () => {
    const sh = new Shell();
    // Each of these is edit-distance ≤ threshold to a builtin (cut→cat, sed→seq,
    // tree→true, cls→ls) and would otherwise produce a confidently-wrong Run.
    for (const tool of ['cut', 'sed', 'tree', 'cls']) {
      const r = await sh.run(tool);
      expect(r.exitCode).toBe(127);
      expect(r.stderr).toContain(`${tool}: command not found`);
      expect(r.stderr).not.toContain('Did you mean');
    }
  });

  it('nudges recognized package managers toward npm (not a wrong Run target)', async () => {
    const sh = new Shell();
    for (const pm of ['npx', 'yarn', 'pnpm', 'bun']) {
      const r = await sh.run(`${pm} install left-pad`);
      expect(r.exitCode).toBe(127);
      expect(r.stderr).toContain(`${pm}: not available`);
      expect(r.stderr).toContain('npm');
      expect(r.stderr).not.toContain('Did you mean');
      expect(r.stderr).not.toContain('command not found');
    }
  });

  it('still suggests a genuine typo of a real builtin (within threshold)', async () => {
    const sh = new Shell();
    expect((await sh.run('gerp x')).stderr).toContain("Did you mean 'grep'?");
    expect((await sh.run('ehco hi')).stderr).toContain("Did you mean 'echo'?");
  });
});

describe('Shell — custom command registration', () => {
  it('exposes builtin core command names separately from registered commands', () => {
    const sh = new Shell();
    sh.registerCommand('npm', async () => 0);
    expect(coreCommandNames()).toContain('ls');
    expect(coreCommandNames()).not.toContain('npm');
    expect(sh.commandNames()).toContain('npm');
  });

  it('exposes registered command names for host-side completion', () => {
    const sh = new Shell();
    sh.registerCommand('greet', async () => 0);
    expect(sh.commandNames()).toContain('grep');
    expect(sh.commandNames()).toContain('greet');
  });

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
    expect(vals(tokenize("echo '$HOME'", { HOME: '/root' }))).toEqual(['echo', '$HOME']);
  });

  it("single quotes don't honour backslash escapes", () => {
    // POSIX: inside `'…'` even \\ stays literal. The only character that
    // terminates the run is a closing `'`.
    expect(vals(tokenize(String.raw`echo 'a\nb'`))).toEqual(['echo', String.raw`a\nb`]);
  });

  it('double quotes expand $VAR', () => {
    expect(vals(tokenize('echo "$HOME"', { HOME: '/root' }))).toEqual(['echo', '/root']);
  });

  it('double quotes expand ${VAR}', () => {
    expect(vals(tokenize('echo "${USER}"', { USER: 'alice' }))).toEqual(['echo', 'alice']);
  });

  it('double quotes preserve whitespace as one token even after expansion', () => {
    expect(vals(tokenize('echo "$X end"', { X: 'a b c' }))).toEqual(['echo', 'a b c end']);
  });

  it('double quotes honour limited backslash escapes', () => {
    expect(vals(tokenize('echo "a\\$b"', { b: 'IGNORED' }))).toEqual(['echo', 'a$b']);
    expect(vals(tokenize('echo "a\\\\b"'))).toEqual(['echo', 'a\\b']);
    expect(vals(tokenize('echo "a\\"b"'))).toEqual(['echo', 'a"b']);
  });

  it('unknown variables expand to empty string', () => {
    expect(vals(tokenize('echo "[$NOPE]"'))).toEqual(['echo', '[]']);
    expect(vals(tokenize('echo $NOPE end'))).toEqual(['echo', '', 'end']);
  });

  it('unquoted $VAR expands but stays one token (no IFS splitting)', () => {
    expect(vals(tokenize('echo $X', { X: 'a b' }))).toEqual(['echo', 'a b']);
  });

  it('adjacent quoted/unquoted segments concatenate into one token', () => {
    expect(vals(tokenize('echo a"b"c'))).toEqual(['echo', 'abc']);
    expect(vals(tokenize("echo a'b'c"))).toEqual(['echo', 'abc']);
  });

  it('${VAR:-default} and similar forms throw — unsupported, not silent', () => {
    expect(() => tokenize('echo ${X:-y}', { X: '' })).toThrow(/unsupported variable expansion/);
  });
});

describe('Shell — command substitution / backticks are loud (not silent literal)', () => {
  it('unquoted $(...) throws (was a silent literal pass-through, a Fidelity bug)', () => {
    expect(() => tokenize('echo $(date)')).toThrow(/command substitution/i);
  });

  it('double-quoted "$(...)" throws — bash substitutes inside double quotes', () => {
    expect(() => tokenize('echo "$(date)"')).toThrow(/command substitution/i);
  });

  it('unquoted backticks throw', () => {
    expect(() => tokenize('echo `pwd`')).toThrow(/command substitution/i);
  });

  it('double-quoted backticks throw', () => {
    expect(() => tokenize('echo "`pwd`"')).toThrow(/command substitution/i);
  });

  it('arithmetic $((...)) is also loud (caught by the same $( guard)', () => {
    expect(() => tokenize('echo $((1+1))')).toThrow(/command substitution/i);
  });

  it('the throw is a NotImplementedError carrying the feature name', () => {
    expect(() => tokenize('echo $(date)')).toThrow(NotImplementedError);
    expect(() => tokenize('echo $(date)')).toThrow(
      expect.objectContaining({ feature: 'shell.command-substitution' }),
    );
  });

  it('single-quoted $(...) stays LITERAL — no throw (bash suppresses in single quotes)', () => {
    expect(vals(tokenize("echo '$(date)'"))).toEqual(['echo', '$(date)']);
  });

  it('single-quoted backticks stay literal', () => {
    expect(vals(tokenize("echo '`pwd`'"))).toEqual(['echo', '`pwd`']);
  });

  it('an escaped \\$( in double quotes is literal (no substitution attempted)', () => {
    expect(vals(tokenize('echo "\\$(date)"'))).toEqual(['echo', '$(date)']);
  });
});

describe('Shell — input redirect', () => {
  // Foreground `cmd < file` is covered in input-redirect.test.ts.
  it('input redirect in a BACKGROUND job (`cmd < file &`) stays loud (out of scope)', async () => {
    const sh = new Shell();
    await expect(sh.run('cat < /etc/hostname &')).rejects.toMatchObject({
      feature: 'shell.input-redirect',
    });
  });
});

describe('Shell — pipes', () => {
  it('tokenises | as its own token (not glued to an argument)', () => {
    // Without dedicated tokenisation `cat a | grep b` would silently become
    // ['cat', 'a', '|', 'grep', 'b'] only by accident if whitespace is right;
    // glued forms like `a|b` would otherwise be one token.
    expect(vals(tokenize('cat a | grep b'))).toEqual(['cat', 'a', '|', 'grep', 'b']);
    expect(vals(tokenize('cat a|grep b'))).toEqual(['cat', 'a', '|', 'grep', 'b']);
  });

  // Foreground pipe execution + the filters' stdin draining are covered in pipes.test.ts.

  it('a piped BACKGROUND job (`a | b &`) stays loud (out of scope)', async () => {
    const sh = new Shell();
    await expect(sh.run('echo a | echo b &')).rejects.toMatchObject({
      feature: 'shell.pipe',
    });
  });
});

describe('Shell — background jobs', () => {
  it('runs a trailing & command in the background and tracks it in jobs', async () => {
    const sh = new Shell();
    let finish: () => void = () => {
      throw new Error('background command was not started');
    };
    sh.registerCommand(
      'slow',
      async () =>
        new Promise<number>((resolve) => {
          finish = () => resolve(0);
        }),
    );
    const chunks: string[] = [];

    const run = await sh.run('slow &', {
      onChunk: (chunk) => chunks.push(chunk),
    });

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe('[1] Running slow\n');
    expect((await sh.run('jobs')).stdout).toBe('[1] Running slow\n');

    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chunks.join('')).toContain('[1] Done slow\n');
    expect((await sh.run('jobs')).stdout).toBe('[1] Done slow\n');
  });

  it('runs background commands in a cloned shell so cd does not mutate parent cwd', async () => {
    const sh = new Shell({ cwd: '/' });
    await sh.run('mkdir -p /fg /bg');
    await sh.run('cd /fg');

    const run = await sh.run('cd /bg &');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(run.exitCode).toBe(0);
    expect(sh.cwd).toBe('/fg');
    expect((await sh.run('pwd')).stdout).toBe('/fg\n');
  });

  it('runs the foreground prefix before backgrounding only the final segment', async () => {
    const sh = new Shell();
    let finish: () => void = () => {};
    sh.registerCommand(
      'slow',
      async () =>
        new Promise<number>((resolve) => {
          finish = () => resolve(0);
        }),
    );

    const run = await sh.run('echo a ; slow &');

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe('a\n[1] Running slow\n');
    expect((await sh.run('jobs')).stdout).toBe('[1] Running slow\n');
    finish();
  });

  it('honors && short-circuit before a trailing background segment', async () => {
    const sh = new Shell();
    let started = false;
    sh.registerCommand('slow', async () => {
      started = true;
      return 0;
    });

    const run = await sh.run('false && slow &');

    expect(run.exitCode).toBe(1);
    expect(started).toBe(false);
    expect((await sh.run('jobs')).stdout).toBe('');
  });

  it('rejects background commands that still need pipe support', async () => {
    const sh = new Shell();
    await expect(sh.run('cat a | grep b &')).rejects.toMatchObject({ feature: 'shell.pipe' });
  });

  it('dispose aborts running background jobs', async () => {
    const sh = new Shell();
    let aborted = false;
    sh.registerCommand(
      'hang',
      async (_args, ctx) =>
        new Promise<number>((resolve) => {
          ctx.signal?.addEventListener('abort', () => {
            aborted = true;
            resolve(130);
          });
        }),
    );

    await sh.run('hang &');
    sh.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(aborted).toBe(true);
  });

  it('&& is a joiner, NOT background — the chain still runs (op discriminator, not substring)', async () => {
    const sh = new Shell();
    const r = await sh.run('echo a && echo b');
    expect(r.stdout).toBe('a\nb\n');
    expect(r.exitCode).toBe(0);
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
      statSyncOrNull: () => null,
      utimes: () => undefined,
      // Never exercised on the redirect-write path; throwing stubs complete
      // the FsSync shape (ADR-0090) without changing this test's behavior.
      copyFileSync: () => {
        throw new Error('unused');
      },
      cpSync: () => {
        throw new Error('unused');
      },
      renameSync: () => {
        throw new Error('unused');
      },
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
  it('exposes a copy of the persisted shell env', async () => {
    const sh = new Shell({ env: { GREETING: 'hello' } });
    await sh.run('NEXT=one');
    const snapshot = sh.envSnapshot();
    expect(snapshot).toEqual({ GREETING: 'hello', NEXT: 'one' });
    snapshot.NEXT = 'mutated';
    expect(sh.envSnapshot().NEXT).toBe('one');
  });

  it('$VAR in arguments expands from the shell env', async () => {
    const sh = new Shell({ env: { GREETING: 'hello there' } });
    const r = await sh.run('echo "$GREETING"');
    expect(r.stdout).toBe('hello there\n');
  });
});

describe('Shell — onChunk streaming writer', () => {
  it('invokes onChunk for each stdout write while the command is running', async () => {
    const sh = new Shell();
    const chunks: { chunk: string; stream: 'stdout' | 'stderr' }[] = [];
    sh.registerCommand('drip', async (_args, ctx) => {
      ctx.stdout.write('one ');
      ctx.stdout.write('two ');
      ctx.stdout.write('three\n');
      return 0;
    });
    const r = await sh.run('drip', {
      onChunk: (chunk, stream) => {
        chunks.push({ chunk, stream });
      },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('one two three\n');
    expect(chunks).toEqual([
      { chunk: 'one ', stream: 'stdout' },
      { chunk: 'two ', stream: 'stdout' },
      { chunk: 'three\n', stream: 'stdout' },
    ]);
  });

  it('invokes onChunk for stderr writes too', async () => {
    const sh = new Shell();
    const chunks: { chunk: string; stream: 'stdout' | 'stderr' }[] = [];
    sh.registerCommand('warn', async (_args, ctx) => {
      ctx.stderr.write('careful\n');
      return 0;
    });
    await sh.run('warn', {
      onChunk: (chunk, stream) => {
        chunks.push({ chunk, stream });
      },
    });
    expect(chunks).toEqual([{ chunk: 'careful\n', stream: 'stderr' }]);
  });

  it('still returns the captured stdout/stderr blob even with onChunk', async () => {
    // Backwards compatibility — existing callers that only read the RunResult
    // must keep seeing the full output, identical to the no-callback path.
    const sh = new Shell();
    sh.registerCommand('say', async (_args, ctx) => {
      ctx.stdout.write('hello\n');
      return 0;
    });
    const r = await sh.run('say', { onChunk: () => {} });
    expect(r.stdout).toBe('hello\n');
  });

  it('omitting onChunk preserves the legacy synchronous return-the-blob contract', async () => {
    // The new option must be additive — calling `run(line)` without options
    // (the shape every existing call-site uses) must continue to work.
    const sh = new Shell();
    const r = await sh.run('echo hi');
    expect(r.stdout).toBe('hi\n');
  });

  it('emits redirect-write-failure chunks via onChunk too', async () => {
    // Redirect failure goes onto stderr; onChunk subscribers should see it
    // as a live stderr chunk, not only via the returned blob.
    const failing: FsSync = {
      existsSync: () => false,
      readFileBytesSync: () => {
        throw new Error('no read');
      },
      writeFileSync: () => {
        throw new Error('disk full');
      },
      readdirSync: () => [],
      mkdirSync: () => undefined,
      rmSync: () => undefined,
      statSync: () => ({ isFile: false, isDirectory: false }),
      statSyncOrNull: () => null,
      utimes: () => undefined,
      // Never exercised on the redirect-write path; throwing stubs complete
      // the FsSync shape (ADR-0090) without changing this test's behavior.
      copyFileSync: () => {
        throw new Error('unused');
      },
      cpSync: () => {
        throw new Error('unused');
      },
      renameSync: () => {
        throw new Error('unused');
      },
    };
    setSyncMirror(failing);
    const sh = new Shell({ cwd: '/' });
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const r = await sh.run('echo hi > /tmp/out', {
      onChunk: (chunk, stream) => {
        if (stream === 'stdout') stdoutChunks.push(chunk);
        if (stream === 'stderr') stderrChunks.push(chunk);
      },
    });
    expect(r.exitCode).not.toBe(0);
    expect(stdoutChunks).toEqual([]);
    expect(stderrChunks.join('')).toMatch(/redirect write failed/);
  });
});

describe('Shell — compound chains (&&, ||, ;)', () => {
  it('&&: runs the next segment only if the previous exit was 0', async () => {
    const sh = new Shell({ cwd: '/' });
    await sh.run('mkdir -p /work');
    const r = await sh.run('cd /work && pwd');
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('/work');
  });

  it('&&: stops the chain when an earlier segment fails', async () => {
    const sh = new Shell({ cwd: '/' });
    const r = await sh.run('cd /does-not-exist && echo reached');
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).not.toMatch(/reached/);
  });

  it('||: runs the next segment only if the previous exit was non-zero', async () => {
    const sh = new Shell({ cwd: '/' });
    const r = await sh.run('cd /does-not-exist || echo recovered');
    expect(r.stdout).toMatch(/recovered/);
    // Final exit is the exit of the LAST executed segment (the echo, which is 0).
    expect(r.exitCode).toBe(0);
  });

  it('||: skips the recovery branch when the first segment succeeded', async () => {
    const sh = new Shell({ cwd: '/' });
    const r = await sh.run('echo first || echo second');
    expect(r.stdout.split('\n').filter(Boolean)).toEqual(['first']);
  });

  it(';: always runs the next segment regardless of exit code', async () => {
    const sh = new Shell({ cwd: '/' });
    const r = await sh.run('cd /does-not-exist ; echo after');
    // Final exit is the exit of the LAST executed segment (the echo).
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/after/);
  });

  it('does NOT split on && inside single quotes', async () => {
    const sh = new Shell();
    const r = await sh.run("echo 'a && b'");
    expect(r.stdout).toBe('a && b\n');
  });

  it('does NOT split on || or ; inside double quotes', async () => {
    const sh = new Shell();
    const r1 = await sh.run('echo "a || b"');
    expect(r1.stdout).toBe('a || b\n');
    const r2 = await sh.run('echo "x ; y"');
    expect(r2.stdout).toBe('x ; y\n');
  });

  it('mixes &&, ||, ; in one line', async () => {
    const sh = new Shell({ cwd: '/' });
    await sh.run('mkdir -p /m');
    // cd /m succeeds → echo ok runs; ; → echo done runs always.
    const r = await sh.run('cd /m && echo ok ; echo done');
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.split('\n').filter(Boolean);
    expect(lines).toEqual(['ok', 'done']);
  });

  it('streams chunks across segments in order via onChunk', async () => {
    const sh = new Shell({ cwd: '/' });
    const chunks: string[] = [];
    await sh.run('echo a && echo b', {
      onChunk: (chunk, stream) => {
        if (stream === 'stdout') chunks.push(chunk);
      },
    });
    expect(chunks.join('')).toBe('a\nb\n');
  });
});

describe('Shell — redirect correctness (Phase-1 fixes)', () => {
  it('>> append preserves multibyte content (encoded-byte sizing, not char count)', async () => {
    const sh = new Shell({ cwd: '/' });
    const t = await sh.run('echo café > /m.txt'); // truncate writes "café\n"
    expect(t.exitCode).toBe(0);
    const a = await sh.run('echo déjà >> /m.txt'); // append must not RangeError
    expect(a.exitCode).toBe(0);
    expect(a.stderr).not.toMatch(/EREDIRECT|out of bounds/);
    const cat = await sh.run('cat /m.txt');
    expect(cat.stdout).toBe('café\ndéjà\n');
  });

  it('redirect truncates/creates the target even when the command writes nothing', async () => {
    const sh = new Shell({ cwd: '/' });
    sh.registerCommand('silent', async () => 0);
    await sh.run('echo old > /e.txt');
    const r = await sh.run('silent > /e.txt');
    expect(r.exitCode).toBe(0);
    const cat = await sh.run('cat /e.txt');
    expect(cat.stdout).toBe(''); // truncated, not left as "old\n"
  });

  it('extracts a redirect that is not the final two tokens (no literal `>` leak)', async () => {
    const sh = new Shell({ cwd: '/' });
    const r = await sh.run('echo hi > /nt.txt extra');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(''); // diverted to the file, not printed
    const cat = await sh.run('cat /nt.txt');
    expect(cat.stdout).toBe('hi extra\n');
  });

  it('allows a redirect target that starts with a dash', async () => {
    const sh = new Shell({ cwd: '/' });
    const r = await sh.run('echo hi > -dash.txt');
    expect(r.exitCode).toBe(0);
    const cat = await sh.run('cat ./-dash.txt');
    expect(cat.stdout).toBe('hi\n');
  });

  it('redirected byte stdout is captured to the file, not streamed to onChunk', async () => {
    const sh = new Shell({ cwd: '/' });
    sh.registerCommand('bytes', async (_args, ctx) => {
      ctx.stdout.write(new Uint8Array([0xff, 0x41]));
      return 0;
    });
    const stdoutChunks: string[] = [];
    const r = await sh.run('bytes > /bytes.bin', {
      onChunk: (chunk, stream) => {
        if (stream === 'stdout') stdoutChunks.push(chunk);
      },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('');
    expect(stdoutChunks).toEqual([]);
    expect(Array.from(syncMirror().readFileBytesSync('/bytes.bin'))).toEqual([0xff, 0x41]);
  });
});

describe('Shell — word elision + exit-code (Phase-1 fixes)', () => {
  it('an unquoted empty $VAR expansion is elided (no surviving empty arg)', async () => {
    const sh = new Shell();
    const r = await sh.run('echo $NOPE end'); // bash drops the empty word
    expect(r.stdout).toBe('end\n');
  });

  it('a quoted empty expansion survives as one argument', async () => {
    const sh = new Shell();
    const r = await sh.run('echo "$NOPE" end');
    expect(r.stdout).toBe(' end\n'); // leading space from the empty quoted arg
  });

  it('rm -rf $UNSET does NOT target the cwd (empty arg elided)', async () => {
    const sh = new Shell({ cwd: '/' });
    await sh.run('mkdir -p /keep/inner');
    await sh.run('echo data > /keep/inner/a');
    await sh.run('rm -rf $UNSET'); // must NOT wipe cwd
    const ls = await sh.run('ls /');
    expect(ls.stdout).toMatch(/keep/); // cwd contents intact
  });

  it('a trailing ; does not reset the exit code to 0', async () => {
    const sh = new Shell({ cwd: '/' });
    const r = await sh.run('false ;');
    expect(r.exitCode).toBe(1);
  });
});

describe('Shell — command errors are clean diagnostics, not JS stack traces', () => {
  it('a command-thrown NotImplementedError surfaces as `cmd: message` with no stack frames', async () => {
    const sh = new Shell({ cwd: '/' });
    await sh.run('mkdir -p /d');
    const r = await sh.run('ls --bogus /d');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/^ls: /);
    expect(r.stderr).toMatch(/not implemented/i);
    expect(r.stderr).not.toMatch(/\n\s+at /); // no V8 stack frames leaked
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

describe('Shell — pre-aborted signal (run cancelled before start)', () => {
  it('never executes segment 0 and resolves 130 (contract: resolves immediately when already aborted)', async () => {
    const sh = new Shell({ cwd: '/' });
    const controller = new AbortController();
    controller.abort();
    const r = await sh.run('mkdir -p /never && cd /never', { signal: controller.signal });
    expect(r.exitCode).toBe(130);
    // No side effects: the first segment must not have run.
    expect(syncMirror().existsSync('/never')).toBe(false);
    expect(sh.cwd).toBe('/');
  });

  it('a pre-aborted trailing background (`cmd &`) never starts the job', async () => {
    const sh = new Shell({ cwd: '/' });
    const controller = new AbortController();
    controller.abort();
    const r = await sh.run('touch /never-bg &', { signal: controller.signal });
    expect(r.exitCode).toBe(130);
    await new Promise((resolve) => setTimeout(resolve, 20)); // job would run async
    expect(syncMirror().existsSync('/never-bg')).toBe(false);
  });
});
