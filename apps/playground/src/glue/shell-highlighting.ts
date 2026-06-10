import type { TerminalHighlightSpan } from '@riftydev/terminal';

const COMMAND = '#7fb2ff';
const STRING = '#c4f042';
const OPERATOR = '#98a1b6';

function isWhitespace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t';
}

function isOperatorAt(line: string, index: number): 1 | 2 | 0 {
  const ch = line[index];
  if (ch === '&' && line[index + 1] === '&') return 2;
  if (ch === '|' && line[index + 1] === '|') return 2;
  if (ch === '>' && line[index + 1] === '>') return 2;
  return ch === '>' || ch === '<' || ch === '|' || ch === '&' || ch === ';' ? 1 : 0;
}

function stringEnd(line: string, start: number, quote: '"' | "'"): number {
  let i = start + 1;
  while (i < line.length) {
    const ch = line[i];
    if (quote === '"' && ch === '\\') {
      i += 2;
      continue;
    }
    i++;
    if (ch === quote) return i;
  }
  return line.length;
}

export function shellLineHighlightSpans(line: string): readonly TerminalHighlightSpan[] {
  const spans: TerminalHighlightSpan[] = [];
  let expectCommand = true;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (isWhitespace(ch)) {
      i++;
      continue;
    }
    const opLen = isOperatorAt(line, i);
    if (opLen > 0) {
      spans.push({ start: i, end: i + opLen, foreground: OPERATOR });
      expectCommand = ch === ';' || ch === '&' || ch === '|';
      i += opLen;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = stringEnd(line, i, ch);
      spans.push({ start: i, end, foreground: STRING });
      i = end;
      expectCommand = false;
      continue;
    }
    const start = i;
    while (i < line.length && !isWhitespace(line[i]) && isOperatorAt(line, i) === 0) {
      if (line[i] === '"' || line[i] === "'") break;
      if (line[i] === '\\') {
        i += 2;
        continue;
      }
      i++;
    }
    if (expectCommand && i > start) {
      spans.push({ start, end: i, foreground: COMMAND });
    }
    expectCommand = false;
  }
  return spans;
}
