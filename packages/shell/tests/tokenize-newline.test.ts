/**
 * Newline, continuation, comment and heredoc lexing on the public `tokenize`
 * (ADR-0091 shape unchanged: a newline lowers to the existing `;` operator).
 * Bash behavior for the same inputs: fixtures/bash/command-lists-bash-3.2.57.json.
 */
import { NotImplementedError } from '@riftydev/io';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { Shell, tokenize } from '../src/index.ts';

const w = (value: string, quoted = false) => ({ value, quoted });
const SEMI = { op: ';' };

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

describe('tokenize — newline', () => {
  it('lowers an unquoted newline after a word to `;`', () => {
    expect(tokenize('echo a\necho b')).toEqual([w('echo'), w('a'), SEMI, w('echo'), w('b')]);
    expect(tokenize('echo a\n')).toEqual([w('echo'), w('a'), SEMI]);
  });

  it('drops a newline after nothing, `;`, `&&`, `||`, `|` or `&`', () => {
    expect(tokenize('\n\necho a')).toEqual([w('echo'), w('a')]);
    expect(tokenize('a;\nb')).toEqual([w('a'), SEMI, w('b')]);
    expect(tokenize('a &&\n\nb')).toEqual([w('a'), { op: '&&' }, w('b')]);
    expect(tokenize('a ||\nb')).toEqual([w('a'), { op: '||' }, w('b')]);
    expect(tokenize('a |\nb')).toEqual([w('a'), { op: '|' }, w('b')]);
    expect(tokenize('a &\n')).toEqual([w('a'), { op: '&' }]);
  });

  it('keeps quoted newlines literal', () => {
    expect(tokenize('node -e "a\nb"')).toEqual([w('node'), w('-e'), w('a\nb', true)]);
    expect(tokenize("echo 'a\nb'")).toEqual([w('echo'), w('a\nb', true)]);
  });

  it('removes unquoted and double-quoted backslash-newline', () => {
    expect(tokenize('echo a \\\nb')).toEqual([w('echo'), w('a'), w('b')]);
    expect(tokenize('ec\\\nho')).toEqual([w('echo')]);
    expect(tokenize('\\\necho')).toEqual([w('echo')]);
    expect(tokenize('echo "a\\\nb"')).toEqual([w('echo'), w('ab', true)]);
    expect(tokenize("echo 'a\\\nb'")).toEqual([w('echo'), w('a\\\nb', true)]);
  });

  it('joins operators, expansions and words across a continuation', () => {
    expect(tokenize('a &\\\n& b >\\\n> f')).toEqual([
      w('a'),
      { op: '&&' },
      w('b'),
      { op: '>>' },
      w('f'),
    ]);
    expect(tokenize('echo $\\\nX a \\\n b', { X: 'v' })).toEqual([
      w('echo'),
      w('v'),
      w('a'),
      w('b'),
    ]);
    expect(thrown(() => tokenize('cat <\\\n<EOF'))).toMatchObject({ feature: 'shell.heredoc' });
  });
});

describe('tokenize — comments', () => {
  it('drops an unquoted word-initial `#` to the end of the line', () => {
    expect(tokenize('echo a # c')).toEqual([w('echo'), w('a')]);
    expect(tokenize('# c\necho a')).toEqual([w('echo'), w('a')]);
    expect(tokenize('echo a;#c')).toEqual([w('echo'), w('a'), SEMI]);
  });

  it('keeps `#` inside a word, quoted or escaped', () => {
    expect(tokenize("echo a#b '#c' \\#d")).toEqual([w('echo'), w('a#b'), w('#c', true), w('#d')]);
  });

  it('never lexes comment text', () => {
    expect(tokenize("echo a # it's $(x) <<EOF & `")).toEqual([w('echo'), w('a')]);
  });
});

describe('tokenize — heredoc and here-string', () => {
  for (const input of ['cat <<EOF', "cat <<'EOF'", 'cat<<EOF', 'cat <<-EOF', 'cat 1<<EOF']) {
    it(`${JSON.stringify(input)} throws shell.heredoc`, () => {
      expect(thrown(() => tokenize(input))).toMatchObject({ feature: 'shell.heredoc' });
    });
  }

  it('throws shell.here-string for `<<<`', () => {
    expect(thrown(() => tokenize('cat <<< hi'))).toMatchObject({ feature: 'shell.here-string' });
  });

  it('attributes a body with backticks and `&` to the heredoc', () => {
    const error = thrown(() => tokenize("cat > f.js <<'JS'\nconst s = `t` & 1;\nJS"));
    expect(error).toBeInstanceOf(NotImplementedError);
    expect(error).toMatchObject({ feature: 'shell.heredoc' });
  });

  it('keeps quoted or escaped `<<` literal', () => {
    expect(tokenize('echo \'<<\' "<<<" a\\<\\<b')).toEqual([
      w('echo'),
      w('<<', true),
      w('<<<', true),
      w('a<<b'),
    ]);
  });
});

describe('Shell — multi-line input', () => {
  it('reserves only literal words: escaped, quoted or expanded `if` is a command name', async () => {
    const shell = new Shell({ env: { CMD: 'if' } });
    shell.registerCommand('if', async (_args, ctx) => {
      ctx.stdout.write('custom-if\n');
      return 0;
    });
    for (const line of ['\\if', "i''f", '$CMD']) {
      expect((await shell.run(line)).stdout).toBe('custom-if\n');
    }
    await expect(shell.run('if')).rejects.toMatchObject({ feature: 'shell.compound-command' });
  });

  it('rejects a heredoc before the background policy in no-background hosts', async () => {
    const shell = new Shell({ allowBackground: false });
    await expect(shell.run("cat > f.js <<'JS'\na & b\nJS")).rejects.toMatchObject({
      feature: 'shell.heredoc',
    });
  });

  it('expands a later line with the variable an earlier line assigned', async () => {
    const fileSystem = new MemoryFsSync();
    fileSystem.mkdirSync('/p/dist', { recursive: true });
    fileSystem.writeFileSync('/p/keep.txt', new Uint8Array([107]));
    fileSystem.writeFileSync('/p/dist/old.js', new Uint8Array([111]));
    const shell = new Shell({ cwd: '/p', fileSystem });

    const result = await shell.run('DIR=dist\nrm -rf $DIR/*');

    expect(result.exitCode).toBe(0);
    expect(fileSystem.existsSync('/p/keep.txt')).toBe(true);
    expect(fileSystem.existsSync('/p/dist/old.js')).toBe(false);
  });

  it('starts a trailing background command followed by a newline', async () => {
    const shell = new Shell();
    let finish: () => void = () => {};
    shell.registerCommand(
      'slow',
      async () =>
        new Promise<number>((resolve) => {
          finish = () => resolve(0);
        }),
    );

    const run = await shell.run('# start\nslow &\n');

    expect(run.stdout).toBe('[1] Running slow\n');
    finish();
  });

  it('expands a background command after its foreground prefix ran', async () => {
    const shell = new Shell();
    const seen: string[] = [];
    let done: () => void = () => {};
    const ran = new Promise<void>((resolve) => {
      done = resolve;
    });
    shell.registerCommand('show', async (args) => {
      seen.push(args.join(' '));
      done();
      return 0;
    });

    await shell.run('X=v; show $X &');
    await ran;

    expect(seen).toEqual(['v']);
  });
});
