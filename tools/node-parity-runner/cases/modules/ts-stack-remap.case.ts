import type { ParityCase } from '../../src/types.ts';

/**
 * TS stack DX parity: caught errors read their stack inside the guest and must
 * report the original `.ts` line, not the lowered JS wrapper line.
 */
const c: ParityCase = {
  kind: 'ts-esm',
  code: [
    'try {',
    '  const value: number = 1;',
    '',
    '',
    '  void value;',
    '  throw new Error("boom");',
    '} catch (err) {',
    '  const stack = (err as Error).stack ?? "";',
    '  const m = String(stack).match(/main\\.ts:(\\d+):\\d+/);',
    '  console.log(m ? `main.ts:${m[1]}` : "missing");',
    '}',
  ].join('\n'),
  expected: 'main.ts:6',
};

export default c;
