import { isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';

export type ShellCompletionMode = 'repl' | 'dev' | 'real-vite';
export type ShellInputValidation = 'complete' | 'incomplete';

export interface ShellCompletionItem {
  readonly value: string;
  readonly display?: string;
}

export interface ShellCompletionResult {
  readonly start: number;
  readonly end: number;
  readonly items: readonly ShellCompletionItem[];
}

export interface ShellHighlightSpan {
  readonly start: number;
  readonly end: number;
  readonly foreground: `#${string}`;
}

export interface CompletionDirEntry {
  readonly name: string;
  readonly isDirectory: boolean;
}

export interface ShellCompletionDeps {
  mode(): ShellCompletionMode;
  commandNames(): readonly string[];
  cwd(): string;
  readdirSync(path: string): readonly CompletionDirEntry[];
}

const COMMAND = '#7fb2ff';
const STRING = '#c4f042';
const OPERATOR = '#98a1b6';
const OPEN_TO_CLOSE = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
]);
const CLOSE = new Set(OPEN_TO_CLOSE.values());

function tokenStart(line: string, cursor: number): number {
  let start = cursor;
  while (start > 0 && !/\s/u.test(line[start - 1] ?? '')) start--;
  return start;
}

function tokenEnd(line: string, cursor: number): number {
  let end = cursor;
  while (end < line.length && !/\s/u.test(line[end] ?? '')) end++;
  return end;
}

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

function isMissingDirectory(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return error.code === 'ENOENT' || error.code === 'ENOTDIR';
  }
  return error instanceof Error && /^(?:ENOENT|ENOTDIR)(?:\b|:)/u.test(error.message);
}

export function createShellCompleter(deps: ShellCompletionDeps) {
  return (line: string, cursor: number): ShellCompletionResult | null => {
    if (deps.mode() === 'repl') return null;
    const start = tokenStart(line, cursor);
    const end = tokenEnd(line, cursor);
    const fragment = line.slice(start, cursor);
    const before = line.slice(0, start);

    // A slash in argv-0 is an explicit path, not a bare command lookup. Route
    // it through the same VFS reader as argument completion (ADR-0362).
    if (before.trim().length === 0 && !fragment.includes('/')) {
      const items: ShellCompletionItem[] = deps
        .commandNames()
        .filter((name) => name.startsWith(fragment))
        .map((name) => ({ value: `${name} `, display: name }));
      return { start, end, items };
    }

    if (fragment.startsWith('-')) return null;
    const slash = fragment.lastIndexOf('/');
    const dirPart = slash >= 0 ? fragment.slice(0, slash + 1) : '';
    const base = slash >= 0 ? fragment.slice(slash + 1) : fragment;
    const dir = isAbsolute(dirPart)
      ? normalizePath(dirPart || '/')
      : normalizePath(joinPath(deps.cwd(), dirPart || '.'));
    try {
      const items: ShellCompletionItem[] = deps
        .readdirSync(dir)
        .filter((entry) => entry.name.startsWith(base))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => ({
          value: `${dirPart}${entry.name}${entry.isDirectory ? '/' : ' '}`,
          display: `${entry.name}${entry.isDirectory ? '/' : ''}`,
        }));
      return { start, end, items };
    } catch (error) {
      if (isMissingDirectory(error)) return null;
      throw error;
    }
  };
}

export function shellLineHighlightSpans(line: string): readonly ShellHighlightSpan[] {
  const spans: ShellHighlightSpan[] = [];
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

export function validateShellInput(line: string, _cursor = line.length): ShellInputValidation {
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
