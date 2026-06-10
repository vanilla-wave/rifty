import { expect, it } from 'vitest';
import { validateShellInput } from './shell-input-validator.ts';

it('treats closed commands as complete', () => {
  expect(validateShellInput('echo ok')).toBe('complete');
  expect(validateShellInput('echo \'ok\' && printf "x"')).toBe('complete');
});

it('keeps unterminated quotes incomplete', () => {
  expect(validateShellInput("echo 'unterminated")).toBe('incomplete');
  expect(validateShellInput('echo "unterminated')).toBe('incomplete');
});

it('keeps trailing continuations and open brackets incomplete', () => {
  expect(validateShellInput('echo \\')).toBe('incomplete');
  expect(validateShellInput('node -e "if (true) {"')).toBe('incomplete');
});
