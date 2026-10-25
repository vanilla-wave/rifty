/**
 * Tokenizer quote-provenance (ADR-0091 part 1). The `quoted` flag is
 * load-bearing for glob expansion (U09): `grep '*.ts'` must stay literal while
 * `grep *.ts` expands — a bare `string[]` couldn't distinguish them, which is
 * the whole reason `tokenize` now returns `Token[]`.
 *
 * Parity tier: unit-only-justified — `tokenize` is a pure string→token function
 * with no `node:*` analog and no GNU output to freeze; the parse contract IS the
 * test (ADR-0093).
 */
import { describe, expect, it } from 'vitest';
import { type Token, tokenize } from '../src/index.ts';

const words = (toks: Token[]) =>
  toks.filter((t): t is { value: string; quoted: boolean } => !('op' in t));

describe('tokenize — quote provenance (ADR-0091)', () => {
  it('marks a single-quoted word quoted — a quoted glob must NOT expand later', () => {
    expect(tokenize("grep '*.ts'")).toEqual([
      { value: 'grep', quoted: false },
      { value: '*.ts', quoted: true },
    ]);
  });

  it('marks a double-quoted word quoted', () => {
    expect(tokenize('grep "*.ts"')).toEqual([
      { value: 'grep', quoted: false },
      { value: '*.ts', quoted: true },
    ]);
  });

  it('leaves an unquoted glob word UNquoted — eligible for expansion', () => {
    expect(tokenize('grep *.ts')).toEqual([
      { value: 'grep', quoted: false },
      { value: '*.ts', quoted: false },
    ]);
  });

  it('a word is quoted if ANY character came from quotes (per-word rule, ADR-0091 §19)', () => {
    // `a"b"c` — only `b` came from quotes, but the whole word is flagged quoted.
    expect(words(tokenize('echo a"b"c'))[1]).toEqual({ value: 'abc', quoted: true });
  });

  it('empty quotes contribute no characters, so a bare metachar stays UNquoted', () => {
    // `*''` — the `*` is unquoted and `''` is empty → no char from quotes → expandable.
    expect(words(tokenize("echo *''"))[1]).toEqual({ value: '*', quoted: false });
  });

  it('keeps bare empty single- and double-quoted words as quoted argv entries', () => {
    expect(tokenize(`node '' ""`)).toEqual([
      { value: 'node', quoted: false },
      { value: '', quoted: true },
      { value: '', quoted: true },
    ]);
  });

  it('an expanded $VAR inside double quotes is quoted; unquoted $VAR is not', () => {
    expect(words(tokenize('echo "$X"', { X: '*.ts' }))[1]).toEqual({ value: '*.ts', quoted: true });
    expect(words(tokenize('echo $X', { X: '*.ts' }))[1]).toEqual({ value: '*.ts', quoted: false });
  });

  it('emits operator tokens with an op discriminator (not words)', () => {
    expect(tokenize('a | b')).toEqual([
      { value: 'a', quoted: false },
      { op: '|' },
      { value: 'b', quoted: false },
    ]);
    expect(tokenize('a && b ; c')).toEqual([
      { value: 'a', quoted: false },
      { op: '&&' },
      { value: 'b', quoted: false },
      { op: ';' },
      { value: 'c', quoted: false },
    ]);
  });
});

describe('tokenize — tilde expansion (bash)', () => {
  const env = { HOME: '/home/rifty' };
  const words = (line: string, scope: Readonly<Record<string, string>> = env) =>
    tokenize(line, scope).map((token) => ('value' in token ? token.value : token.op));

  it('expands an unquoted word-initial ~ and ~/ to $HOME', () => {
    expect(words('cd ~')).toEqual(['cd', '/home/rifty']);
    expect(words('cat ~/.npmrc')).toEqual(['cat', '/home/rifty/.npmrc']);
    expect(words('echo x > ~/out')).toEqual(['echo', 'x', '>', '/home/rifty/out']);
    expect(words('ls ~;pwd')).toEqual(['ls', '/home/rifty', ';', 'pwd']);
  });

  it('keeps quoted, mid-word, ~user and HOME-less tildes literal', () => {
    expect(words('echo \'~\' "~/x" a~b ~root')).toEqual(['echo', '~', '~/x', 'a~b', '~root']);
    expect(words('echo ~/x', {})).toEqual(['echo', '~/x']);
  });
});
