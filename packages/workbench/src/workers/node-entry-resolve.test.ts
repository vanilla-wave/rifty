import { describe, expect, it } from 'vitest';
import { classifyNodeInvocation, resolveNodeEntry } from './node-entry-resolve.ts';

const TERMINATED_SEPARATED_EVAL_SPELLINGS = [
  {
    option: '-e',
    print: false,
    sourceRequired: true,
    missing: 'node: -e requires an argument\n',
  },
  {
    option: '--eval',
    print: false,
    sourceRequired: true,
    missing: 'node: --eval requires an argument\n',
  },
  {
    option: '-pe',
    print: true,
    sourceRequired: true,
    missing: 'node: --eval requires an argument\n',
  },
  { option: '-p', print: true, sourceRequired: false, missing: '' },
  { option: '--print', print: true, sourceRequired: false, missing: '' },
  { option: '--print=ignored', print: true, sourceRequired: false, missing: '' },
  { option: '--print=not-the-source', print: true, sourceRequired: false, missing: '' },
  { option: '--print=', print: true, sourceRequired: false, missing: '' },
] as const;
const OPTIONAL_PRINT_SPELLINGS = [
  '-p',
  '--print',
  '--print=ignored',
  '--print=not-the-source',
  '--print=',
] as const;
const ACCEPTED_INPUT_TYPES = [
  '--input-type=commonjs',
  '--input-type=module',
  '--input-type=commonjs-typescript',
  '--input-type=module-typescript',
] as const;
const MANDATORY_EVAL_SOURCE_SPELLINGS = [
  { option: '-e', print: false, missing: 'node: -e requires an argument\n' },
  { option: '--eval', print: false, missing: 'node: --eval requires an argument\n' },
  { option: '-pe', print: true, missing: 'node: --eval requires an argument\n' },
] as const;
const INPUT_TYPE_MANDATORY_SOURCE_CASES = ACCEPTED_INPUT_TYPES.flatMap((inputType) =>
  MANDATORY_EVAL_SOURCE_SPELLINGS.map((spelling) => ({ inputType, ...spelling })),
);
const INPUT_TYPE_EMPTY_MANDATORY_SOURCE_CASES = [
  {
    inputType: '--input-type=commonjs',
    option: '-e',
    print: false,
    expectedKind: 'eval',
  },
  {
    inputType: '--input-type=commonjs',
    option: '--eval',
    print: false,
    expectedKind: 'eval',
  },
  {
    inputType: '--input-type=commonjs',
    option: '-pe',
    print: true,
    expectedKind: 'eval',
  },
  {
    inputType: '--input-type=module',
    option: '-e',
    print: false,
    expectedKind: 'evalModule',
  },
  {
    inputType: '--input-type=module',
    option: '--eval',
    print: false,
    expectedKind: 'evalModule',
  },
  {
    inputType: '--input-type=module',
    option: '-pe',
    print: true,
    expectedKind: 'evalModulePrintError',
  },
  {
    inputType: '--input-type=commonjs-typescript',
    option: '-e',
    print: false,
    expectedKind: 'evalTypeScript',
  },
  {
    inputType: '--input-type=commonjs-typescript',
    option: '--eval',
    print: false,
    expectedKind: 'evalTypeScript',
  },
  {
    inputType: '--input-type=commonjs-typescript',
    option: '-pe',
    print: true,
    expectedKind: 'evalTypeScript',
  },
  {
    inputType: '--input-type=module-typescript',
    option: '-e',
    print: false,
    expectedKind: 'evalTypeScript',
  },
  {
    inputType: '--input-type=module-typescript',
    option: '--eval',
    print: false,
    expectedKind: 'evalTypeScript',
  },
  {
    inputType: '--input-type=module-typescript',
    option: '-pe',
    print: true,
    expectedKind: 'evalModulePrintError',
  },
] as const;

const TERMINATED_EVAL_SOURCE_STATES = [
  { state: 'missing', source: undefined },
  { state: 'empty', source: '' },
  { state: 'nonempty', source: 'source' },
] as const;

function buildTerminatedClassifierCases(): readonly {
  readonly label: string;
  readonly args: readonly string[];
  readonly expected: unknown;
}[] {
  return TERMINATED_SEPARATED_EVAL_SPELLINGS.flatMap((spelling) =>
    TERMINATED_EVAL_SOURCE_STATES.map((sourceState) => {
      if (sourceState.source === undefined) {
        return {
          label: `${spelling.option} / missing`,
          args: [spelling.option, '--'],
          expected: spelling.sourceRequired
            ? { kind: 'usageError', message: spelling.missing }
            : {
                kind: 'eval',
                source: '',
                print: spelling.print,
                execArgv: [spelling.option],
                scriptArgs: [],
              },
        };
      }

      if (sourceState.source === '' && !spelling.sourceRequired) {
        return {
          label: `${spelling.option} / empty`,
          args: [spelling.option, '', '--', 'x'],
          expected: {
            kind: 'eval',
            source: '',
            print: spelling.print,
            execArgv: [spelling.option],
            scriptArgs: ['', '--', 'x'],
          },
        };
      }

      return {
        label: `${spelling.option} / ${sourceState.state}`,
        args: [spelling.option, sourceState.source, '--', 'x'],
        expected: {
          kind: 'eval',
          source: sourceState.source,
          print: spelling.print,
          execArgv: [spelling.option, sourceState.source],
          scriptArgs: ['x'],
        },
      };
    }),
  );
}

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

  it.each(buildTerminatedClassifierCases())(
    '$label crosses eval source state with the immediate terminator',
    ({ args, expected }) => {
      expect(classifyNodeInvocation(args)).toEqual(expected);
    },
  );

  it('attached --eval= source consumes an immediate terminator too', () => {
    expect(classifyNodeInvocation(['--eval=source', '--', 'alpha', 'two words', '-x'])).toEqual({
      kind: 'eval',
      source: 'source',
      print: false,
      execArgv: ['--eval=source'],
      scriptArgs: ['alpha', 'two words', '-x'],
    });
  });

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

  it.each(['-p', '--print', '--print=ignored', '--print=not-the-source', '--print='] as const)(
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

  it.each(['-p', '--print', '--print=ignored', '--print=not-the-source', '--print='] as const)(
    '%s distinguishes an empty post-terminator token from the program transition',
    (option) => {
      expect(
        classifyNodeInvocation([option, '--', '', 'alpha', '-x']),
        'empty first token keeps entryless eval',
      ).toEqual({
        kind: 'eval',
        source: '',
        print: true,
        execArgv: [option],
        scriptArgs: ['', 'alpha', '-x'],
      });
      expect(
        classifyNodeInvocation([option, '--', 'entry.cjs', 'alpha', '-x']),
        'non-empty first token selects the named program gap',
      ).toEqual({ kind: 'printProgram' });
    },
  );

  it.each(['--print=ignored', '--print=not-the-source', '--print='] as const)(
    '%s ignores its RHS, preserves the exact spelling, and takes source from the next argument',
    (option) => {
      expect(classifyNodeInvocation([option, 'process.platform', 'alpha'])).toEqual({
        kind: 'eval',
        source: 'process.platform',
        print: true,
        execArgv: [option, 'process.platform'],
        scriptArgs: ['alpha'],
      });
      expect(classifyNodeInvocation([option])).toEqual({
        kind: 'eval',
        source: '',
        print: true,
        execArgv: [option],
        scriptArgs: [],
      });
    },
  );

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
  });

  it('routes supported preload spellings to one named no-child context gap', () => {
    for (const args of [
      ['-r', 'preload.cjs', '-p', '1'],
      ['--require', 'preload.cjs', '-p', '1'],
      ['--require=preload.cjs', '-p', '1'],
      ['--import', 'preload.mjs', '-p', '1'],
      ['--import=preload.mjs', '-p', '1'],
    ]) {
      expect(classifyNodeInvocation(args)).toEqual({ kind: 'preloadContext' });
    }
  });

  it.each(['-r', '--require', '--import'] as const)(
    '%s consumes a separated empty preload value and selects the named context gap',
    (option) => {
      expect(classifyNodeInvocation([option, '', '-p', '1'])).toEqual({
        kind: 'preloadContext',
      });
    },
  );

  it.each([
    ['-r', 'preload.cjs', 'entry.cjs'],
    ['--require', 'preload.cjs', 'entry.cjs'],
    ['--require=preload.cjs', 'entry.cjs'],
    ['--import', 'preload.mjs', 'entry.cjs'],
    ['--import=preload.mjs', 'entry.cjs'],
    ['-r', '', 'entry.cjs'],
    ['--require', '', 'entry.cjs'],
    ['--import', '', 'entry.cjs'],
  ])('routes a valid preload before a program entry to the named context gap: %j', (...args) => {
    expect(classifyNodeInvocation(args)).toEqual({ kind: 'preloadContext' });
  });

  it.each([
    { args: ['-r'], option: '-r' },
    { args: ['--require'], option: '--require' },
    { args: ['--import'], option: '--import' },
  ] as const)(
    '$option preserves Node usage when its preload value is omitted',
    ({ args, option }) => {
      expect(classifyNodeInvocation(args)).toEqual({
        kind: 'usageError',
        message: `node: ${option} requires an argument\n`,
      });
    },
  );

  it.each(['--require=', '--import='] as const)(
    '%s preserves Node usage for an empty long-equals preload value',
    (option) => {
      expect(classifyNodeInvocation([option, '-p', '1'])).toEqual({
        kind: 'usageError',
        message: `node: ${option} requires an argument\n`,
      });
    },
  );

  it('preserves explicit CommonJS input type in eval identity and argv', () => {
    expect(classifyNodeInvocation(['--input-type=commonjs', '-e', '1', '--', 'alpha'])).toEqual({
      kind: 'eval',
      source: '1',
      print: false,
      execArgv: ['--input-type=commonjs', '-e', '1'],
      scriptArgs: ['alpha'],
    });
    expect(classifyNodeInvocation(['--input-type=commonjs', '--eval=2', '--', 'beta'])).toEqual({
      kind: 'eval',
      source: '2',
      print: false,
      execArgv: ['--input-type=commonjs', '--eval=2'],
      scriptArgs: ['beta'],
    });
    expect(classifyNodeInvocation(['--input-type=commonjs', '-p'])).toEqual({
      kind: 'eval',
      source: '',
      print: true,
      execArgv: ['--input-type=commonjs', '-p'],
      scriptArgs: [],
    });
    expect(classifyNodeInvocation(['--input-type=commonjs', '-p', '--', '', 'gamma'])).toEqual({
      kind: 'eval',
      source: '',
      print: true,
      execArgv: ['--input-type=commonjs', '-p'],
      scriptArgs: ['', 'gamma'],
    });
  });

  it.each(INPUT_TYPE_MANDATORY_SOURCE_CASES)(
    '$inputType $option preserves missing-source usage before context selection',
    ({ inputType, option, missing }) => {
      expect(classifyNodeInvocation([inputType, option])).toEqual({
        kind: 'usageError',
        message: missing,
      });
    },
  );

  it.each(ACCEPTED_INPUT_TYPES)(
    '%s preserves empty attached --eval= usage before context selection',
    (inputType) => {
      expect(classifyNodeInvocation([inputType, '--eval='])).toEqual({
        kind: 'usageError',
        message: 'node: --eval= requires an argument\n',
      });
    },
  );

  it.each(INPUT_TYPE_MANDATORY_SOURCE_CASES)(
    '$inputType $option treats an immediate terminator as a missing mandatory source',
    ({ inputType, option, missing }) => {
      expect(classifyNodeInvocation([inputType, option, '--'])).toEqual({
        kind: 'usageError',
        message: missing,
      });
    },
  );

  it.each(INPUT_TYPE_EMPTY_MANDATORY_SOURCE_CASES)(
    '$inputType $option consumes a separated empty mandatory source and selects $expectedKind',
    ({ inputType, option, print, expectedKind }) => {
      expect(classifyNodeInvocation([inputType, option, ''])).toEqual(
        expectedKind === 'eval'
          ? {
              kind: 'eval',
              source: '',
              print,
              execArgv: [inputType, option, ''],
              scriptArgs: [],
            }
          : { kind: expectedKind },
      );
    },
  );

  it('splits ESM eval gaps from Node-invalid ESM print forms', () => {
    for (const option of ['-e', '--eval', '--eval=1']) {
      expect(classifyNodeInvocation(['--input-type=module', option, '1'])).toEqual({
        kind: 'evalModule',
      });
    }
    for (const option of ['-p', '--print', '--print=ignored', '-pe']) {
      expect(classifyNodeInvocation(['--input-type=module', option, '1'])).toEqual({
        kind: 'evalModulePrintError',
      });
    }
  });

  it('routes explicit TypeScript inputs with ESM print-error precedence', () => {
    for (const option of ['-e', '--eval', '--eval=1', '-p', '--print', '--print=ignored', '-pe']) {
      expect(classifyNodeInvocation(['--input-type=commonjs-typescript', option, '1'])).toEqual({
        kind: 'evalTypeScript',
      });
    }
    for (const option of ['-e', '--eval', '--eval=1']) {
      expect(classifyNodeInvocation(['--input-type=module-typescript', option, '1'])).toEqual({
        kind: 'evalTypeScript',
      });
    }
    for (const option of ['-p', '--print', '--print=ignored', '-pe']) {
      expect(classifyNodeInvocation(['--input-type=module-typescript', option, '1'])).toEqual({
        kind: 'evalModulePrintError',
      });
    }
  });

  it('keeps input-type optional-print program transitions ahead of eval-context outcomes', () => {
    for (const inputType of [
      '--input-type=commonjs',
      '--input-type=module',
      '--input-type=commonjs-typescript',
      '--input-type=module-typescript',
    ]) {
      for (const option of OPTIONAL_PRINT_SPELLINGS) {
        expect(classifyNodeInvocation([inputType, option, '--', 'entry.cjs'])).toEqual({
          kind: 'printProgram',
        });
      }
    }
    for (const option of OPTIONAL_PRINT_SPELLINGS) {
      expect(classifyNodeInvocation(['--input-type=commonjs', option, '--', ''])).toEqual({
        kind: 'eval',
        source: '',
        print: true,
        execArgv: ['--input-type=commonjs', option],
        scriptArgs: [''],
      });
      expect(
        classifyNodeInvocation(['--input-type=commonjs-typescript', option, '--', '']),
      ).toEqual({
        kind: 'evalTypeScript',
      });
      for (const inputType of ['--input-type=module', '--input-type=module-typescript']) {
        expect(classifyNodeInvocation([inputType, option, '--', ''])).toEqual({
          kind: 'evalModulePrintError',
        });
      }
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
