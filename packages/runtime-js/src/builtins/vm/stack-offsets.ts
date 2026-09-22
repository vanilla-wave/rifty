/**
 * vm `lineOffset` / `columnOffset` shift reported stacks for a filename.
 * Physical execution is unchanged. Columns clamp at 1, matching Node.
 */
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
  if (lineOffset === 0 && columnOffset === 0) {
    OFFSETS.delete(filename);
    return;
  }
  OFFSETS.set(filename, { line: lineOffset, column: columnOffset });
  installHook();
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
