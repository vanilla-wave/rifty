/**
 * Node v24's fatal report (`src/node_errors.cc` ReportFatalException) without
 * its `<file>:<line>` header: the error as `inspect(error, { customInspect:
 * false })` prints it, the `--trace-uncaught` hint for a primitive, and the
 * `Node.js <version>` trailer. The one text every host prints for a fatal
 * error (goal node-file-entry-parity I2–I4). The header is V8's message
 * location, which JS cannot read: never printed (compat process.md "Fatal
 * error stderr bytes"; only `-e`'s own `[eval]` decoration carries one).
 *
 * Frames: rifty's own runtime frames are dropped — a frame is kept when its
 * location is guest code (`[eval]`, a file in the guest VFS) or a V8 builtin
 * called from guest code.
 */
import { syncMirror } from '@riftydev/vfs';
import type { Node as AcornNode } from 'acorn';
import { cjsLineOnePrefix } from '../module-loader/cjs-factory.ts';
import { ModuleLoadError } from '../module-loader/errors.ts';
import { inspect } from '../repl/inspect.ts';
import { enclosing, offsetOf, parseProgram } from './fatal-source.ts';
import { NODE_PROCESS_IDENTITY } from './process-identity.ts';

/** Node's `\nNode.js <version>\n` (`extra_info_on_fatal_exception`). */
export const FATAL_TRAILER = `\nNode.js ${NODE_PROCESS_IDENTITY.version}\n`;

const HINT = '(Use `node --trace-uncaught ...` to show where the exception was thrown)';
const FRAME = /^\s+at /u;
const RUNTIME_LOCATION =
  /^(?:[a-z][a-z0-9+.-]*:\/\/|blob:|<isolated-vm>$)|rifty-isolate-guest\.js$/u;
const decorated = new WeakSet<object>();
const reflectApply = Reflect.apply;
const errorToString = Error.prototype.toString;
const objectToString = Object.prototype.toString;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectKeys = Object.keys;
const objectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const objectGetPrototypeOf = Object.getPrototypeOf;

/** Node `IsExceptionDecorated`: the error's stack already carries its header (`-e`). */
export function markFatalDecorated(error: object): void {
  decorated.add(error);
}

interface FrameLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

/** `file:line:col` of a V8 frame line (`at f (loc)`, `at loc`, eval origins excluded). */
function frameLocation(frame: string): FrameLocation | null {
  const body = frame.replace(/^\s+at (?:async )?/u, '');
  const inner = /\(([^()]*)\)$/u.exec(body)?.[1] ?? body;
  const m = /^(.*):(\d+):(\d+)$/u.exec(inner);
  if (m === null) return null;
  return { file: m[1] as string, line: Number(m[2]), column: Number(m[3]) };
}

function filePath(file: string): string | null {
  if (file.startsWith('file://')) {
    try {
      return decodeURIComponent(file.slice('file://'.length));
    } catch {
      return null;
    }
  }
  return file.startsWith('/') ? file : null;
}

let evalSource: string | null = null;

/** The running `-e` source: the report reads `[eval]` frames against it. */
export function setFatalEvalSource(source: string | null): void {
  evalSource = source;
}

function readGuestSource(file: string): string | null {
  if (file === '[eval]') return evalSource;
  const path = filePath(file);
  if (path === null) return null;
  try {
    const vfs = syncMirror();
    if (!vfs.existsSync(path)) return null;
    return new TextDecoder().decode(vfs.readFileBytesSync(path));
  } catch {
    return null;
  }
}

type FrameKind = 'user' | 'builtin' | 'runtime';

function frameKind(frame: string): FrameKind {
  // Code compiled from a string (`eval`, `Function`): guest code.
  if (frame.includes('(eval at ')) return 'user';
  const location = frameLocation(frame);
  if (location === null) {
    // `at JSON.parse (<anonymous>)`, `at async Promise.all (index 0)`, `native`.
    return /\((?:<anonymous>|native|index \d+)\)$/u.test(frame) ? 'builtin' : 'runtime';
  }
  if (location.file === '[eval]') return 'user';
  const path = filePath(location.file);
  // A location rifty's own code runs from (a served URL, the isolate bundle);
  // any other relative name is guest text (a hand-written `stack`): kept.
  if (path === null) return RUNTIME_LOCATION.test(location.file) ? 'runtime' : 'user';
  try {
    return syncMirror().existsSync(path) ? 'user' : 'runtime';
  } catch {
    return 'runtime';
  }
}

/** The stack with rifty-runtime frames dropped; a builtin frame stays when guest code called it. */
/** Text after a frame's closing `)` (or its bare `file:line:col`), with balanced parens. */
function frameTail(line: string): string {
  let depth = 0;
  for (let i = line.indexOf(' at ') + 4; i < line.length; i += 1) {
    const c = line[i];
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return line.slice(i + 1);
    }
  }
  if (depth !== 0) return '';
  const bare = /^(\s+at (?:async )?\S+:\d+:\d+)(.*)$/u.exec(line);
  return bare?.[2] ?? '';
}

function guestStack(stack: string): { readonly text: string; readonly frames: string[] } {
  // Every frame line of the text, a nested error's included (an inspected
  // prop, `[errors]`, an object holding an error).
  // A frame line inside inspect output may carry inspect text after the frame
  // (` {`, `,`, ` }`, `, code: 7 }`): split it off and keep it.
  const lines = stack.split('\n');
  const suffixes = lines.map((line) => (FRAME.test(line) ? frameTail(line) : ''));
  for (let i = 0; i < lines.length; i += 1) {
    const suffix = suffixes[i] as string;
    if (suffix !== '') lines[i] = (lines[i] as string).slice(0, -suffix.length);
  }
  const kinds = lines.map((line) => (FRAME.test(line) ? frameKind(line) : null));
  const out: string[] = [];
  const frames: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const kind = kinds[i];
    if (kind === null || kind === undefined) {
      out.push(line);
      continue;
    }
    let caller: FrameKind | null | undefined = 'user';
    if (kind === 'builtin') {
      caller = null;
      for (let k = i + 1; k < kinds.length && kinds[k] !== null; k += 1) {
        if (kinds[k] !== 'builtin') {
          caller = kinds[k];
          break;
        }
      }
    }
    const suffix = suffixes[i] as string;
    if (kind === 'runtime' || caller !== 'user') {
      // The opener or comma of a dropped last frame moves up a line.
      if (suffix !== '' && out.length > 0) out.push(`${out.pop() as string}${suffix}`);
      continue;
    }
    const frame = kind === 'user' ? asNodeFrame(line) : line;
    out.push(`${frame}${suffix}`);
    frames.push(frame);
  }
  return { text: out.join('\n'), frames };
}

const EVAL_NAMED = /^(\s+at )(async )?(new )?(?:([^\s()]+)\.)?eval(?: \[as ([^\]]+)\])? \((.*)\)$/u;

/**
 * A CJS factory frame as Node's `compileFunction` script shows it: line 1
 * columns without the shared-line prefix, and V8's `eval` name for an
 * anonymous function of eval-compiled code removed (Node: no name).
 */
function asNodeFrame(frame: string): string {
  if (frame.includes('(eval at ')) {
    // rifty's Function routing is the origin V8 records: not a guest place.
    // A module compiled from a string records its eval origin without a position.
    return frame.replace(/eval at ([^\s(),]+) \(([^()]+)\)/gu, (whole, name: string, at: string) =>
      frameKind(`    at x (${/:\d+:\d+$/u.test(at) ? at : `${at}:1:1`})`) === 'runtime'
        ? `eval at ${name}`
        : whole,
    );
  }
  const location = frameLocation(frame);
  const prefix =
    location === null
      ? undefined
      : location.file === '[eval]'
        ? 0
        : cjsLineOnePrefix(location.file);
  if (location === null || prefix === undefined) return frame;
  let text = frame;
  if (prefix > 0 && location.line === 1 && location.column > prefix) {
    const at = `${location.file}:1:${location.column}`;
    text = `${text.slice(0, text.lastIndexOf(at))}${location.file}:1:${location.column - prefix}${text.slice(text.lastIndexOf(at) + at.length)}`;
  }
  const named = EVAL_NAMED.exec(text);
  const column = prefix > 0 && location.line === 1 ? location.column - prefix : location.column;
  if (named === null || namesEval(location.file, location.line, column)) return text;
  const at = named[1] as string;
  const async = named[2] ?? '';
  const ctor = named[3] ?? '';
  const type = named[4];
  const method = named[5];
  const place = named[6] as string;
  if (type === undefined)
    return ctor === '' ? `${at}${async}${place}` : `${at}${async}${ctor}<anonymous> (${place})`;
  return `${at}${async}${ctor}${type}.${method ?? '<anonymous>'} (${place})`;
}

function keyName(node: unknown): string | null {
  const key = (node as { key?: { type?: string; name?: string; value?: unknown } } | null)?.key;
  if (key?.type === 'Identifier') return key.name ?? null;
  return typeof key?.value === 'string' ? key.value : null;
}

/**
 * Whether the function running at `line:column` of `file` is itself named (or
 * inferred) `eval` — then V8's `eval` is its real name, not the eval-script
 * default for an anonymous function.
 */
function namesEval(file: string, line: number, column: number): boolean {
  const source = readGuestSource(file);
  const root = source === null ? null : parseProgram(source, file);
  const offset = source === null ? null : offsetOf(source, line, column - 1);
  if (root === null || offset === null) return true;
  const chain = enclosing(root, offset);
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const node = chain[i] as AcornNode & { id?: { name?: string } | null };
    if (!/Function/u.test(node.type)) continue;
    if (node.id?.name !== undefined) return node.id.name === 'eval';
    const parent = chain[i - 1] as (AcornNode & { id?: { name?: string } }) | undefined;
    if (parent?.type === 'VariableDeclarator') return parent.id?.name === 'eval';
    return keyName(parent) === 'eval';
  }
  return false;
}

/** The first frame of `stack` located in guest code (`[eval]` or a guest file). */
export function firstGuestFrame(stack: string): string | null {
  return guestStack(stack).frames.find((frame) => frameKind(frame) === 'user') ?? null;
}

const STACK_THREW = Symbol('stack threw');

function readStack(error: object): string | null | typeof STACK_THREW {
  try {
    const stack = (error as { stack?: unknown }).stack;
    return typeof stack === 'string' ? stack : null;
  } catch {
    return STACK_THREW;
  }
}

function stackOf(error: object): string | null {
  const stack = readStack(error);
  return stack === STACK_THREW ? null : stack;
}

/** Node `IsNativeError`: only an Error is reported as one; any other object is inspected. */
function isErrorLike(value: unknown): value is object {
  if (value instanceof Error) return true;
  // Another realm's Error (a vm context) carries the [[ErrorData]] brand too.
  return (
    typeof value === 'object' &&
    value !== null &&
    reflectApply(objectToString, value, []) === '[object Error]'
  );
}

interface InspectState {
  readonly ancestors: object[];
  circular: boolean;
}

/** Node's report inspects at `depth: max(inspect.defaultOptions.depth, 5)`. */
const REPORT_DEPTH = 5;

/** Node's inspect of a value inside an error's props block, at `indent` columns, `depth` deep. */
function propValue(value: unknown, indent: number, state: InspectState, depth: number): string {
  if (typeof value === 'object' && value !== null && state.ancestors.includes(value)) {
    state.circular = true;
    return '[Circular *1]';
  }
  if (depth > REPORT_DEPTH && typeof value === 'object' && value !== null)
    return Array.isArray(value) ? '[Array]' : `[${constructorName(value) ?? 'Object'}]`;
  if (isErrorLike(value)) return inspectError(value, indent, state, depth);
  // Node groups more than 6 entries into columns (rifty's inspect layout then).
  // Elements are read by descriptor only: an accessor element never runs.
  const primitives = Array.isArray(value) && value.length <= 6 ? primitiveElements(value) : null;
  if (primitives !== null) {
    const items = primitives.map((v) => inspect(v));
    const start = items.length + indent + 1 + 10;
    const total = items.reduce((sum, item) => sum + item.length, items.length + start);
    if (items.length === 0) return '[]';
    if (total <= 80) return `[ ${items.join(', ')} ]`;
    const pad = ' '.repeat(indent);
    return `[\n${pad}  ${items.join(`,\n${pad}  `)}\n${pad}]`;
  }
  return inspect(value, { depth: REPORT_DEPTH - depth, customInspect: false });
}

/** A dense array's elements when each is an own data primitive, else null. */
function primitiveElements(array: readonly unknown[]): unknown[] | null {
  // Non-index keys or symbols: inspect lists them after the elements.
  if (objectKeys(array).length !== array.length || objectGetOwnPropertySymbols(array).length > 0)
    return null;
  const out: unknown[] = [];
  for (let i = 0; i < array.length; i += 1) {
    const d = objectGetOwnPropertyDescriptor(array, i);
    if (d === undefined || !('value' in d)) return null;
    if (typeof d.value === 'object' && d.value !== null) return null;
    out.push(d.value);
  }
  return out;
}

/** Node `getConstructorName` without running guest getters: the first own data `constructor`. */
function constructorName(error: object): string | null {
  for (let o: object | null = error; o !== null; o = objectGetPrototypeOf(o)) {
    const ctor = objectGetOwnPropertyDescriptor(o, 'constructor')?.value;
    if (typeof ctor !== 'function') continue;
    const name = objectGetOwnPropertyDescriptor(ctor, 'name')?.value;
    return typeof name === 'string' && name !== '' ? name : null;
  }
  return null;
}

/**
 * Node's internal errors read `Error [CODE]: message`; rifty's loader raises
 * them as `ModuleLoadError` named `Error` (`ERR_REQUIRE_*`).
 */
function nodeInternalHead(stack: string, error: object): string {
  if (!(error instanceof ModuleLoadError) || !error.code.startsWith('ERR_REQUIRE_')) return stack;
  // After `-e`'s own `[eval]:N` decoration too.
  return stack.replace(
    /^((?:\[eval\]:\d+\n[^\n]*\n *\^\n\n)?)Error: /u,
    `$1Error [${error.code}]: `,
  );
}

/** Node `improveStack`: `NotFound [Error]: …` when the class name hides the error's name. */
function improveStack(stack: string, error: object): string {
  let errorName: unknown;
  for (
    let o: object | null = error;
    o !== null && errorName === undefined;
    o = objectGetPrototypeOf(o)
  ) {
    errorName = objectGetOwnPropertyDescriptor(o, 'name')?.value;
  }
  const ctor = constructorName(error);
  if (typeof errorName !== 'string' || ctor === null || ctor === errorName) return stack;
  const len = errorName.length;
  if (!errorName.endsWith('Error') || !stack.startsWith(errorName)) return stack;
  if (stack.length !== len && stack[len] !== ':' && stack[len] !== '\n') return stack;
  return ctor.includes(errorName)
    ? `${ctor}${stack.slice(len)}`
    : `${ctor} [${errorName}]${stack.slice(len)}`;
}

/** Node `formatError` + `reduceToSingleString`; accessors read as `[Getter]`, never run. */
function inspectError(error: object, indent: number, state: InspectState, depth: number): string {
  const raw = stackOf(error) ?? (reflectApply(errorToString, error, []) as string);
  state.ancestors.push(error);
  // Frames are projected once, over the whole report (`guestStack`).
  let base = improveStack(nodeInternalHead(raw, error), error);
  // Node brackets a stackless error; a runtime-decorated stack is not one.
  if (!/\n\s+at /u.test(raw) && !decorated.has(error)) base = `[${base}]`;
  if (indent > 0) base = base.replaceAll('\n', `\n${' '.repeat(indent)}`);
  const entries: string[] = [];
  // Own enumerable keys, then enumerable symbols (Node prints `Symbol(x): v`).
  const keys: (string | symbol)[] = objectKeys(error);
  const symbols = objectGetOwnPropertySymbols(error);
  for (let k = 0; k < symbols.length; k += 1) {
    const symbol = symbols[k] as symbol;
    if (objectGetOwnPropertyDescriptor(error, symbol)?.enumerable === true) keys.push(symbol);
  }
  for (let k = 0; k < keys.length; k += 1) {
    const own = keys[k] as string | symbol;
    if (own === 'stack') continue;
    const key = typeof own === 'symbol' ? own.toString() : own;
    const descriptor = objectGetOwnPropertyDescriptor(error, own);
    if (descriptor === undefined) continue;
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      const kind =
        descriptor.get !== undefined && descriptor.set !== undefined
          ? 'Getter/Setter'
          : descriptor.get !== undefined
            ? 'Getter'
            : 'Setter';
      entries.push(`${key}: [${kind}]`);
      continue;
    }
    const value = descriptor.value;
    if ((key === 'name' || key === 'message') && typeof value === 'string' && raw.includes(value))
      continue;
    entries.push(`${key}: ${propValue(value, indent + 2, state, depth + 1)}`);
  }
  const hidden = ['cause', 'errors'] as const;
  for (let k = 0; k < hidden.length; k += 1) {
    const key = hidden[k] as (typeof hidden)[number];
    const descriptor = objectGetOwnPropertyDescriptor(error, key);
    if (descriptor?.enumerable !== false) continue;
    if ('value' in descriptor)
      entries.push(`[${key}]: ${propValue(descriptor.value, indent + 2, state, depth + 1)}`);
    // Node prints a hidden accessor `[cause]: [Getter]` (and runs it once; rifty never does).
    else if (descriptor.get !== undefined) entries.push(`[${key}]: [Getter]`);
  }
  state.ancestors.pop();
  if (indent === 0 && state.circular) base = `<ref *1> ${base}`;
  if (entries.length === 0) return base;
  const single = `${base} { ${entries.join(', ')} }`;
  if (!raw.includes('\n') && !single.includes('\n') && single.length + indent <= 80) return single;
  const pad = ' '.repeat(indent);
  return `${base} {\n${pad}  ${entries.join(`,\n${pad}  `)}\n${pad}}`;
}

function primitiveText(value: unknown): string {
  return typeof value === 'symbol' ? value.toString() : String(value);
}

/**
 * The one point a rifty loader error takes Node's shape, wherever it was
 * thrown: a CJS-loader `MODULE_NOT_FOUND` (it carries `requireStack`) is Node's
 * plain `Error` with `code` and `requireStack`, its frames kept.
 */
function asNodeError(error: unknown): unknown {
  if (!(error instanceof ModuleLoadError)) return error;
  if (error.code !== 'MODULE_NOT_FOUND' || error.requireStack === undefined) return error;
  const out = new Error(error.message) as Error & { code?: string; requireStack?: unknown };
  // V8 wrote `Error:` there: ModuleLoadError names itself after capture.
  out.stack = stackOf(error) ?? `Error: ${error.message}`;
  out.code = error.code;
  out.requireStack = error.requireStack;
  return out;
}

/** The whole fatal report for `error`, ending in the trailer's newline. */
export function formatFatalReport(thrown: unknown): string {
  const error = asNodeError(thrown);
  if (!isErrorLike(error)) {
    const body =
      (typeof error === 'object' && error !== null) || typeof error === 'function'
        ? guestStack(inspect(error, { depth: REPORT_DEPTH, customInspect: false })).text
        : `${primitiveText(error)}\n${HINT}`;
    return `${body}\n${FATAL_TRAILER}`;
  }
  // Node: a `stack` that throws when read leaves the error's own text and the hint.
  if (readStack(error) === STACK_THREW)
    return `${reflectApply(errorToString, error, []) as string}\n${HINT}\n${FATAL_TRAILER}`;
  return `${guestStack(inspectError(error, 0, { ancestors: [], circular: false }, 0)).text}\n${FATAL_TRAILER}`;
}

/** Node's fallback where inspecting the error fails (a throwing Proxy trap): its stack alone. */
export function formatFatalStack(error: unknown): string | null {
  if (!isErrorLike(error)) return null;
  const stack = stackOf(error);
  return stack === null ? null : `${guestStack(stack).text}\n${FATAL_TRAILER}`;
}
