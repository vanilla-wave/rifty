/**
 * vm `lineOffset` / `columnOffset` shift reported stacks for a filename.
 * Physical execution is unchanged. Columns clamp at 1, matching Node.
 * One filename has one offset. A later script that reuses the name with a
 * different offset throws instead of rewriting the first script's stacks.
 */
import { NotImplementedError } from '@riftydev/io';

interface VmStackOffset {
  readonly line: number;
  readonly column: number;
}

const OFFSETS = new Map<string, VmStackOffset>();
let installed = false;

export function registerVmStackOffset(
  filename: string,
  lineOffset: number,
  columnOffset: number,
): void {
  if (!Number.isFinite(lineOffset) || !Number.isFinite(columnOffset)) return;
  const next = { line: lineOffset, column: columnOffset };
  const prev = OFFSETS.get(filename);
  if (prev) {
    if (prev.line === next.line && prev.column === next.column) return;
    throw new NotImplementedError(
      'vm.Script.lineOffset',
      `filename ${filename} already has a different stack offset`,
    );
  }
  OFFSETS.set(filename, next);
  if (next.line !== 0 || next.column !== 0) installHook();
}

export function shiftVmStackLocations(stack: string): string {
  if (OFFSETS.size === 0) return stack;
  return stack.replace(
    /(\(?)([^()\n]+?):(\d+):(\d+)(\)?)/g,
    (full, open: string, file: string, line: string, column: string, close: string) => {
      const offset = OFFSETS.get(file);
      if (!offset) return full;
      const nextLine = Math.max(1, Number(line) + offset.line);
      const nextColumn = Math.max(1, Number(column) + offset.column);
      return `${open}${file}:${nextLine}:${nextColumn}${close}`;
    },
  );
}

function renderDefault(err: Error, sites: readonly { toString(): string }[]): string {
  const title =
    err.name && err.message ? `${err.name}: ${err.message}` : err.name || err.message || 'Error';
  return [title, ...sites.map((site) => `    at ${site.toString()}`)].join('\n');
}

function installHook(): void {
  if (installed) return;
  installed = true;
  const errorCtor = Error as ErrorConstructor & {
    prepareStackTrace?: (err: Error, sites: readonly { toString(): string }[]) => unknown;
  };
  const previous = errorCtor.prepareStackTrace;
  errorCtor.prepareStackTrace = (err, sites) => {
    const rendered =
      typeof previous === 'function' ? String(previous(err, sites)) : renderDefault(err, sites);
    return shiftVmStackLocations(rendered);
  };
}
