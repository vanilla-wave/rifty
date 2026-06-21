/**
 * Node-compatible `node:console`.
 *
 * Pure-JS re-implementation of Node's `Console` class. There is no native
 * binding behind `node:console` — it is a JS class over two writable streams
 * (`lib/internal/console/constructor.js`) — so we mirror the observable
 * contract (printf formatting, `table` box-drawing, group indentation, the
 * counter/timer maps) rather than stub it (CLAUDE.md "no silent stubs").
 *
 * Surface implemented:
 *  - `new Console(stdout[, stderr])` / `new Console({ stdout, stderr,
 *    inspectOptions, colorMode, groupIndentation, ignoreErrors })`.
 *  - `log` / `info` / `debug` / `dir` → stdout; `warn` / `error` / `trace` →
 *    stderr. `log`-family apply `util.format` printf semantics.
 *  - `assert(value, ...message)` — writes `Assertion failed[: message]` to
 *    stderr when `value` is falsy (no throw — Node's never throws).
 *  - `group` / `groupCollapsed` / `groupEnd` — indent tracking, configurable
 *    `groupIndentation` (default 2 spaces).
 *  - `count` / `countReset` — per-label monotonic counter, `label: n` to stdout.
 *  - `time` / `timeEnd` / `timeLog` — per-label timers using the realm clock.
 *  - `table(data[, columns])` — box-drawing table with an `(index)` column, a
 *    `Values` column for primitive rows, the union of own keys across object
 *    rows, left-aligned cells, and fall-back to `log` for non-tabular input.
 *    Matches Node v24's `lib/internal/cli_table.js` byte-for-byte (ASCII).
 *  - `clear` — no-op against a non-TTY stream (Node only emits the clear escape
 *    on a TTY; our backing streams are not TTYs).
 *
 * The module-level export is Node-shaped: a default `Console` instance (routed
 * at `process.stdout` / `process.stderr`) augmented with the `Console`
 * constructor as a property, so both `require('node:console').log` and
 * `const { Console } = require('node:console')` work.
 */
import { inspect } from '../repl/inspect.ts';
import { riftyProcess } from './process.ts';
import { format } from './util.ts';

/** A writable-stream-shaped sink: anything exposing `write(chunk)`. */
interface WritableLike {
  write(chunk: string): unknown;
}

interface ConsoleOptions {
  stdout: WritableLike;
  stderr?: WritableLike;
  // Accepted for shape compatibility (undici passes `inspectOptions`); our
  // inspector models no colors, so only `groupIndentation` affects output.
  inspectOptions?: Record<string, unknown>;
  colorMode?: boolean | 'auto';
  ignoreErrors?: boolean;
  groupIndentation?: number;
}

const kColorInspectOptions = Symbol('kColorInspectOptions');

/**
 * Apply `util.format` printf semantics to a log call's arguments. A zero-arg
 * call yields `''` (Node's `util.format()` → `''`, distinct from
 * `util.format(undefined)` → `'undefined'`).
 */
function formatLine(args: readonly unknown[]): string {
  if (args.length === 0) return '';
  return format(args[0], ...args.slice(1));
}

/**
 * Render a table cell the way Node's table does: strings single-quoted,
 * `undefined`/`null`/booleans/numbers/bigints bare, everything else through the
 * structural inspector.
 */
function formatCell(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`;
  return inspect(value);
}

/**
 * Re-implements Node's `lib/internal/cli_table.js`. Each column carries a header
 * plus already-stringified cells aligned by row index (missing cells empty).
 * Box-drawing table, trailing newline, left-aligned cells wrapped in one
 * leading and one trailing space.
 */
function renderTable(columns: readonly TableColumn[]): string {
  const rows = columns.length === 0 ? 0 : Math.max(...columns.map((c) => c.cells.length));
  const widths = columns.map((col) => {
    let w = col.header.length;
    for (const cell of col.cells) if (cell.length > w) w = cell.length;
    return w;
  });

  const HORIZ = '─';
  const pad = (s: string, w: number): string => ` ${s}${' '.repeat(w - s.length)} `;
  const line = (left: string, mid: string, right: string): string =>
    left + widths.map((w) => HORIZ.repeat(w + 2)).join(mid) + right;

  let out = `${line('┌', '┬', '┐')}\n`;
  out += `│${columns.map((col, i) => pad(col.header, widths[i] as number)).join('│')}│\n`;
  out += `${line('├', '┼', '┤')}\n`;
  for (let r = 0; r < rows; r++) {
    out += `│${columns.map((col, i) => pad(col.cells[r] ?? '', widths[i] as number)).join('│')}│\n`;
  }
  out += `${line('└', '┴', '┘')}\n`;
  return out;
}

/** One rendered table column: a header plus already-stringified row cells. */
interface TableColumn {
  header: string;
  cells: string[];
}

export class Console {
  #stdout: WritableLike;
  #stderr: WritableLike;
  #groupIndentation: number;
  #indent = '';
  #counts = new Map<string, number>();
  #times = new Map<string, number>();
  [kColorInspectOptions]?: Record<string, unknown>;

  constructor(stdoutOrOptions: WritableLike | ConsoleOptions, stderr?: WritableLike) {
    let stdout: WritableLike;
    let resolvedStderr: WritableLike | undefined;
    let groupIndentation = 2;
    if (
      stdoutOrOptions &&
      typeof (stdoutOrOptions as ConsoleOptions).stdout !== 'undefined' &&
      typeof (stdoutOrOptions as WritableLike).write !== 'function'
    ) {
      const opts = stdoutOrOptions as ConsoleOptions;
      stdout = opts.stdout;
      resolvedStderr = opts.stderr;
      if (typeof opts.groupIndentation === 'number') groupIndentation = opts.groupIndentation;
      this[kColorInspectOptions] = opts.inspectOptions;
    } else {
      stdout = stdoutOrOptions as WritableLike;
      resolvedStderr = stderr;
    }
    if (!stdout || typeof stdout.write !== 'function') {
      throw new TypeError('Console expects a writable stream instance');
    }
    this.#stdout = stdout;
    this.#stderr = resolvedStderr ?? stdout;
    this.#groupIndentation = groupIndentation;
  }

  #writeOut(text: string): void {
    this.#stdout.write(this.#indent ? this.#applyIndent(text) : text);
  }

  #writeErr(text: string): void {
    this.#stderr.write(this.#indent ? this.#applyIndent(text) : text);
  }

  #applyIndent(text: string): string {
    // Indent every line except the trailing empty segment after the final
    // newline, matching Node's per-line group indentation.
    const nl = text.endsWith('\n');
    const body = nl ? text.slice(0, -1) : text;
    const indented = body
      .split('\n')
      .map((l) => this.#indent + l)
      .join('\n');
    return nl ? `${indented}\n` : indented;
  }

  log = (...args: unknown[]): void => {
    this.#writeOut(`${formatLine(args)}\n`);
  };

  info = (...args: unknown[]): void => {
    this.#writeOut(`${formatLine(args)}\n`);
  };

  debug = (...args: unknown[]): void => {
    this.#writeOut(`${formatLine(args)}\n`);
  };

  dir = (value: unknown, _options?: unknown): void => {
    this.#writeOut(`${inspect(value)}\n`);
  };

  // Node's `console.dirxml(...data)` for non-DOM data is exactly `this.log(...data)`.
  dirxml = (...args: unknown[]): void => {
    this.log(...args);
  };

  warn = (...args: unknown[]): void => {
    this.#writeErr(`${formatLine(args)}\n`);
  };

  error = (...args: unknown[]): void => {
    this.#writeErr(`${formatLine(args)}\n`);
  };

  trace = (...args: unknown[]): void => {
    const stack = new Error('Trace').stack ?? '';
    const tail = stack.slice(stack.indexOf('\n') + 1);
    const msg = args.length > 0 ? `: ${formatLine(args)}` : '';
    this.#writeErr(`Trace${msg}\n${tail}\n`);
  };

  assert = (value: unknown, ...message: unknown[]): void => {
    if (value) return;
    const tail = message.length > 0 ? `: ${formatLine(message)}` : '';
    this.#writeErr(`Assertion failed${tail}\n`);
  };

  group = (...label: unknown[]): void => {
    if (label.length > 0) this.log(...label);
    this.#indent += ' '.repeat(this.#groupIndentation);
  };

  groupCollapsed = (...label: unknown[]): void => {
    this.group(...label);
  };

  groupEnd = (): void => {
    const next = this.#indent.length - this.#groupIndentation;
    this.#indent = this.#indent.slice(0, Math.max(0, next));
  };

  count = (label = 'default'): void => {
    const next = (this.#counts.get(label) ?? 0) + 1;
    this.#counts.set(label, next);
    this.#writeOut(`${label}: ${next}\n`);
  };

  countReset = (label = 'default'): void => {
    this.#counts.delete(label);
  };

  time = (label = 'default'): void => {
    if (this.#times.has(label)) {
      this.#writeErr(`Warning: Label '${label}' already exists for console.time()\n`);
      return;
    }
    this.#times.set(label, performanceNow());
  };

  timeEnd = (label = 'default'): void => {
    const start = this.#times.get(label);
    if (start === undefined) {
      this.#writeErr(`Warning: No such label '${label}' for console.timeEnd()\n`);
      return;
    }
    this.#times.delete(label);
    this.#writeOut(`${label}: ${formatDuration(performanceNow() - start)}\n`);
  };

  timeLog = (label = 'default', ...data: unknown[]): void => {
    const start = this.#times.get(label);
    if (start === undefined) {
      this.#writeErr(`Warning: No such label '${label}' for console.timeLog()\n`);
      return;
    }
    const suffix = data.length > 0 ? ` ${formatLine(data)}` : '';
    this.#writeOut(`${label}: ${formatDuration(performanceNow() - start)}${suffix}\n`);
  };

  clear = (): void => {
    // Backing streams are not TTYs, so — like Node — nothing to clear.
  };

  table = (data: unknown, columns?: readonly string[]): void => {
    // Non-tabular (primitive/null) input falls back to `log`, matching Node.
    if (data === null || typeof data !== 'object') {
      this.log(data);
      return;
    }

    const INDEX_HEADER = '(index)';
    const VALUES_HEADER = 'Values';

    const entries: Array<[string, unknown]> = Array.isArray(data)
      ? (data as unknown[]).map((v, i) => [String(i), v])
      : Object.entries(data as Record<string, unknown>);

    // Union of inner-object keys (first-seen order); a primitive row needs the
    // `Values` column.
    const innerKeys: string[] = [];
    const seen = new Set<string>();
    let hasPrimitiveRow = false;
    for (const [, value] of entries) {
      if (value !== null && typeof value === 'object') {
        for (const k of Object.keys(value as Record<string, unknown>)) {
          if (!seen.has(k)) {
            seen.add(k);
            innerKeys.push(k);
          }
        }
      } else {
        hasPrimitiveRow = true;
      }
    }

    const dataKeys = columns ? [...columns] : innerKeys;

    // Column 0 = indices; middle = per-key cells; last (optional) = primitive
    // values. Cells filled per row so columns stay aligned (absent key → empty).
    const indexCol: TableColumn = { header: INDEX_HEADER, cells: [] };
    const keyCols: TableColumn[] = dataKeys.map((k) => ({ header: k, cells: [] }));
    const valuesCol: TableColumn = { header: VALUES_HEADER, cells: [] };

    for (const [indexKey, value] of entries) {
      indexCol.cells.push(indexKey);
      if (value !== null && typeof value === 'object') {
        const rec = value as Record<string, unknown>;
        dataKeys.forEach((k, i) => {
          keyCols[i]?.cells.push(k in rec ? formatCell(rec[k]) : '');
        });
        if (hasPrimitiveRow) valuesCol.cells.push('');
      } else {
        for (const col of keyCols) col.cells.push('');
        if (hasPrimitiveRow) valuesCol.cells.push(formatCell(value));
      }
    }

    const cols: TableColumn[] = [indexCol, ...keyCols];
    if (hasPrimitiveRow) cols.push(valuesCol);

    this.#writeOut(renderTable(cols));
  };
}

/** Monotonic millisecond clock for `time`/`timeEnd`. */
function performanceNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Format a millisecond duration the way Node's `console.timeEnd` does. */
function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(3)}s`;
  return `${ms.toFixed(3)}ms`;
}

/**
 * Default module-level `Console`, routed at `process.stdout` / `process.stderr`.
 * `process.stdout.write` forwards to the realm's global `console.log` (see
 * `builtins/process.ts`), preserving existing stdout/stderr wiring.
 */
const defaultConsole = new Console(riftyProcess.stdout, riftyProcess.stderr);

// Node's module export is the default instance augmented with the `Console`
// constructor as a property.
const consoleModule = defaultConsole as Console & { Console: typeof Console };
consoleModule.Console = Console;

export default consoleModule;
