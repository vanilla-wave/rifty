import { describe, expect, it } from 'vitest';
import { classifyNodeInvocation, resolveNodeEntry } from './node-entry-resolve.ts';

describe('classifyNodeInvocation', () => {
  it('-v / --version → version (not a /workspace/--version path)', () => {
    expect(classifyNodeInvocation(['-v'])).toEqual({ kind: 'version' });
    expect(classifyNodeInvocation(['--version'])).toEqual({ kind: 'version' });
  });

  it('-e/--eval carry exact source, execArgv, terminator, and entryless script args', () => {
    expect(classifyNodeInvocation(['-e', 'console.log(1)'])).toEqual({
      kind: 'eval',
      source: 'console.log(1)',
      print: false,
      execArgv: ['-e', 'console.log(1)'],
      scriptArgs: [],
    });
    expect(classifyNodeInvocation(['--eval', 'x', '--', 'alpha', 'two words'])).toEqual({
      kind: 'eval',
      source: 'x',
      print: false,
      execArgv: ['--eval', 'x'],
      scriptArgs: ['alpha', 'two words'],
    });
  });

  it('--eval=SRC keeps the original single-token execArgv spelling', () => {
    expect(classifyNodeInvocation(['--eval=1+1'])).toEqual({
      kind: 'eval',
      source: '1+1',
      print: false,
      execArgv: ['--eval=1+1'],
      scriptArgs: [],
    });
  });

  it('-p/--print consume the next source and retain exact execArgv', () => {
    expect(classifyNodeInvocation(['-p', '1+1'])).toEqual({
      kind: 'eval',
      source: '1+1',
      print: true,
      execArgv: ['-p', '1+1'],
      scriptArgs: [],
    });
    expect(classifyNodeInvocation(['--print', 'process.platform', 'alpha'])).toEqual({
      kind: 'eval',
      source: 'process.platform',
      print: true,
      execArgv: ['--print', 'process.platform'],
      scriptArgs: ['alpha'],
    });
  });

  it.each([
    {
      label: '-e',
      args: ['-e', 'source', '--', 'alpha', 'two words', '-x'],
      execArgv: ['-e', 'source'],
      print: false,
    },
    {
      label: '--eval',
      args: ['--eval', 'source', '--', 'alpha', 'two words', '-x'],
      execArgv: ['--eval', 'source'],
      print: false,
    },
    {
      label: '--eval=',
      args: ['--eval=source', '--', 'alpha', 'two words', '-x'],
      execArgv: ['--eval=source'],
      print: false,
    },
    {
      label: '-p',
      args: ['-p', 'source', '--', 'alpha', 'two words', '-x'],
      execArgv: ['-p', 'source'],
      print: true,
    },
    {
      label: '--print',
      args: ['--print', 'source', '--', 'alpha', 'two words', '-x'],
      execArgv: ['--print', 'source'],
      print: true,
    },
    {
      label: '--print=ignored',
      args: ['--print=ignored', 'source', '--', 'alpha', 'two words', '-x'],
      execArgv: ['--print=ignored', 'source'],
      print: true,
    },
    {
      label: '-pe',
      args: ['-pe', 'source', '--', 'alpha', 'two words', '-x'],
      execArgv: ['-pe', 'source'],
      print: true,
    },
  ] as const)(
    '$label consumes an immediate terminator before exposing entryless script args',
    ({ args, execArgv, print }) => {
      expect(classifyNodeInvocation(args)).toEqual({
        kind: 'eval',
        source: 'source',
        print,
        execArgv,
        scriptArgs: ['alpha', 'two words', '-x'],
      });
    },
  );

  it.each([
    { option: '-e', print: false, missing: 'node: -e requires an argument\n' },
    { option: '--eval', print: false, missing: 'node: --eval requires an argument\n' },
    { option: '-pe', print: true, missing: 'node: --eval requires an argument\n' },
  ] as const)('$option distinguishes a separated empty source from absence', (testCase) => {
    expect([
      classifyNodeInvocation([testCase.option]),
      classifyNodeInvocation([testCase.option, '']),
    ]).toEqual([
      { kind: 'usageError', message: testCase.missing },
      {
        kind: 'eval',
        source: '',
        print: testCase.print,
        execArgv: [testCase.option, ''],
        scriptArgs: [],
      },
    ]);
  });

  it.each(['-p', '--print', '--print=ignored'] as const)(
    '%s keeps a separated empty token in argv, unlike absent source',
    (option) => {
      expect([classifyNodeInvocation([option]), classifyNodeInvocation([option, ''])]).toEqual([
        {
          kind: 'eval',
          source: '',
          print: true,
          execArgv: [option],
          scriptArgs: [],
        },
        {
          kind: 'eval',
          source: '',
          print: true,
          execArgv: [option],
          scriptArgs: [''],
        },
      ]);
    },
  );

  it('--print=RHS ignores RHS and takes source from the next argument', () => {
    expect(classifyNodeInvocation(['--print=ignored', 'process.platform', 'alpha'])).toEqual({
      kind: 'eval',
      source: 'process.platform',
      print: true,
      execArgv: ['--print=ignored', 'process.platform'],
      scriptArgs: ['alpha'],
    });
    expect(classifyNodeInvocation(['--print=ignored'])).toEqual({
      kind: 'eval',
      source: '',
      print: true,
      execArgv: ['--print=ignored'],
      scriptArgs: [],
    });
  });

  it('-pe is accepted but the reversed -ep spelling is not', () => {
    expect(classifyNodeInvocation(['-pe', '1+1', 'alpha'])).toEqual({
      kind: 'eval',
      source: '1+1',
      print: true,
      execArgv: ['-pe', '1+1'],
      scriptArgs: ['alpha'],
    });
    expect(classifyNodeInvocation(['-ep', '1+1'])).toEqual({
      kind: 'badOption',
      flag: '-ep',
    });
  });

  it('bare -p/--print evaluate an empty script and preserve the lone option', () => {
    expect(classifyNodeInvocation(['-p'])).toEqual({
      kind: 'eval',
      source: '',
      print: true,
      execArgv: ['-p'],
      scriptArgs: [],
    });
    expect(classifyNodeInvocation(['--print'])).toEqual({
      kind: 'eval',
      source: '',
      print: true,
      execArgv: ['--print'],
      scriptArgs: [],
    });
  });

  it('unknown leading-dash flag → badOption (never MODULE_NOT_FOUND on /workspace/<flag>)', () => {
    expect(classifyNodeInvocation(['--frobnicate'])).toEqual({
      kind: 'badOption',
      flag: '--frobnicate',
    });
    expect(classifyNodeInvocation(['-i'])).toEqual({ kind: 'badOption', flag: '-i' });
    expect(classifyNodeInvocation(['--inspect'])).toEqual({
      kind: 'badOption',
      flag: '--inspect',
    });
    expect(classifyNodeInvocation(['--env-file=.env'])).toEqual({
      kind: 'badOption',
      flag: '--env-file=.env',
    });
    for (const flag of ['-r', '--require', '--import']) {
      expect(classifyNodeInvocation([flag, 'preload.cjs'])).toEqual({
        kind: 'badOption',
        flag,
      });
    }
  });

  it('missing/empty eval source stays loud', () => {
    expect(classifyNodeInvocation(['-e'])).toEqual({
      kind: 'usageError',
      message: 'node: -e requires an argument\n',
    });
    expect(classifyNodeInvocation(['--eval'])).toEqual({
      kind: 'usageError',
      message: 'node: --eval requires an argument\n',
    });
    expect(classifyNodeInvocation(['--eval='])).toEqual({
      kind: 'usageError',
      message: 'node: --eval= requires an argument\n',
    });
    expect(classifyNodeInvocation(['-pe'])).toEqual({
      kind: 'usageError',
      message: 'node: --eval requires an argument\n',
    });
  });

  it('every attached short eval/print source spelling stays a bad option', () => {
    for (const flag of [
      '-eSRC',
      '-e=SRC',
      '-pSRC',
      '-p=SRC',
      '-peSRC',
      '-pe=SRC',
      '-epSRC',
      '-ep=SRC',
    ]) {
      expect(classifyNodeInvocation([flag])).toEqual({ kind: 'badOption', flag });
    }
  });

  it('a non-flag path → entry (today behavior preserved)', () => {
    expect(classifyNodeInvocation(['app.js', '--port', '3000'])).toEqual({
      kind: 'entry',
      arg: 'app.js',
      scriptArgs: ['--port', '3000'],
    });
  });

  it('no args → missing (bare REPL stays the documented ceiling)', () => {
    expect(classifyNodeInvocation([])).toEqual({ kind: 'missing' });
    expect(classifyNodeInvocation([''])).toEqual({ kind: 'missing' });
  });
});

describe('resolveNodeEntry', () => {
  it('absolutizes a relative path against cwd', () => {
    expect(resolveNodeEntry('/w', 'app.js')).toEqual({ ok: true, path: '/w/app.js' });
  });

  it('returns ok for a missing file too — the loader emits the real Node MODULE_NOT_FOUND', () => {
    // backlog/runtime-js/node-entry-miss-node-shape: the owner no longer
    // pre-checks existence (the old terse `node: cannot find module` form). A
    // missing entry now flows into runNodeEntry → the module loader, which throws
    // real Node's `Error: Cannot find module '<abs>' … { code:'MODULE_NOT_FOUND',
    // requireStack: [] }` on the child stderr.
    expect(resolveNodeEntry('/w', 'nope.js')).toEqual({ ok: true, path: '/w/nope.js' });
  });

  it('keeps an absolute path as-is', () => {
    expect(resolveNodeEntry('/w', '/abs/app.js')).toEqual({ ok: true, path: '/abs/app.js' });
  });

  it('errors with usage when no file is given', () => {
    expect(resolveNodeEntry('/w', undefined)).toEqual({
      ok: false,
      message: 'node: missing entry file\nUsage: node <file> [args]\n',
    });
    expect(resolveNodeEntry('/w', '')).toEqual({
      ok: false,
      message: 'node: missing entry file\nUsage: node <file> [args]\n',
    });
  });
});
