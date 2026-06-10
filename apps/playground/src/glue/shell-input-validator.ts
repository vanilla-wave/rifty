import type { TerminalInputValidation } from '@riftydev/terminal';

const OPEN_TO_CLOSE = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
]);

const CLOSE = new Set(OPEN_TO_CLOSE.values());

export function validateShellInput(line: string, _cursor = line.length): TerminalInputValidation {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  const stack: string[] = [];
  for (const ch of line) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      if (OPEN_TO_CLOSE.has(ch)) stack.push(OPEN_TO_CLOSE.get(ch) ?? '');
      else if (CLOSE.has(ch) && stack.at(-1) === ch) stack.pop();
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (OPEN_TO_CLOSE.has(ch)) {
      stack.push(OPEN_TO_CLOSE.get(ch) ?? '');
      continue;
    }
    if (CLOSE.has(ch) && stack.at(-1) === ch) stack.pop();
  }
  return quote || escaped || stack.length > 0 ? 'incomplete' : 'complete';
}
