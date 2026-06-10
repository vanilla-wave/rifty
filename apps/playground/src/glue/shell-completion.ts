import type { TerminalCompleter, TerminalCompletionItem } from '@riftydev/terminal';
import { isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';

export type CompletionMode = 'repl' | 'dev' | 'real-vite';

export interface CompletionDirEntry {
  readonly name: string;
  readonly isDirectory: boolean;
}

export interface ShellCompletionDeps {
  mode(): CompletionMode;
  commandNames(): readonly string[];
  cwd(): string;
  readdirSync(path: string): readonly CompletionDirEntry[];
}

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

export function createShellCompleter(deps: ShellCompletionDeps): TerminalCompleter {
  return (line, cursor) => {
    if (deps.mode() === 'repl') return null;
    const start = tokenStart(line, cursor);
    const end = tokenEnd(line, cursor);
    const fragment = line.slice(start, cursor);
    const before = line.slice(0, start);

    if (before.trim().length === 0) {
      const items: TerminalCompletionItem[] = deps
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
      const items: TerminalCompletionItem[] = deps
        .readdirSync(dir)
        .filter((entry) => entry.name.startsWith(base))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => ({
          value: `${dirPart}${entry.name}${entry.isDirectory ? '/' : ' '}`,
          display: `${entry.name}${entry.isDirectory ? '/' : ''}`,
        }));
      return { start, end, items };
    } catch {
      return null;
    }
  };
}
