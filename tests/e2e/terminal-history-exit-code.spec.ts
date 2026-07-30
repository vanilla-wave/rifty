import { expect, test } from '@playwright/test';
import { decodeTerminalHistoryExitCode } from './helpers/playground.ts';

test.describe('terminal history exit-code decoding', () => {
  const validCases = [
    ['zero', '0', 0],
    ['positive integer', '7', 7],
    ['largest safe integer', '9007199254740991', Number.MAX_SAFE_INTEGER],
  ] as const;
  for (const [description, raw, expected] of validCases) {
    test(`accepts an exact ${description}`, () => {
      expect(decodeTerminalHistoryExitCode(raw, 'node -e "probe"')).toBe(expected);
    });
  }

  const invalidCases = [
    ['absent attribute', undefined],
    ['null attribute', null],
    ['empty attribute', ''],
    ['space-only attribute', '   '],
    ['tab/newline-only attribute', '\t\n'],
    ['negative integer', '-1'],
    ['negative zero', '-0'],
    ['explicit positive sign', '+1'],
    ['leading zero', '01'],
    ['decimal', '1.0'],
    ['exponent', '1e2'],
    ['non-number', 'running'],
    ['unsafe integer', '9007199254740992'],
  ] as const;
  for (const [description, raw] of invalidCases) {
    test(`rejects ${description} instead of fabricating exit 0`, () => {
      expect(() => decodeTerminalHistoryExitCode(raw, 'node -e "probe"')).toThrow(
        'terminal history has no exact exit code for node -e "probe"',
      );
    });
  }
});
