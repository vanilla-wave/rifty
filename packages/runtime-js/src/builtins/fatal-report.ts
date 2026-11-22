/**
 * Node v24's fatal report (`src/node_errors.cc` ReportFatalException): the
 * `<file>:<line>` header with source line and caret, the error as
 * `inspect(error, { customInspect: false })` prints it, the `--trace-uncaught`
 * hint for a primitive, and the `Node.js <version>` trailer. The one text
 * every host prints for a fatal error (goal node-file-entry-parity I2–I4).
 *
 * Frames: rifty's own runtime frames are dropped — a frame is kept when its
 * location is guest code (`[eval]`, a file in the guest VFS) or a V8 builtin
 * called from guest code. Header: V8's message location, which JS cannot read
 * for a synchronous throw; it is printed only where the source proves it
 * (`throwSiteHeader`), else omitted (compat process.md "Fatal error stderr bytes").
 */
import { syncMirror } from '@riftydev/vfs';
import { type Node as AcornNode, parse as acornParse } from 'acorn';
import { cjsLineOnePrefix } from '../module-loader/cjs-factory.ts';
import { inspect } from '../repl/inspect.ts';
import { NODE_PROCESS_IDENTITY } from './process-identity.ts';

export type FatalOrigin = 'uncaughtException' | 'unhandledRejection';

const HINT = '(Use `node --trace-uncaught ...` to show where the exception was thrown)';
const FRAME = /^\s+at /u;
const decorated = new WeakSet<object>();
const reflectApply = Reflect.apply;
const errorToString = Error.prototype.toString;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectKeys = Object.keys;

const headers = new WeakMap<object, string>();
const origins = new WeakMap<object, FatalOrigin>();

/** The dispatch that made `reason` fatal, for a host that prints it later (isolate guest). */
export function setFatalOrigin(reason: unknown, origin: FatalOrigin): void {
  if ((typeof reason === 'object' && reason !== null) || typeof reason === 'function')
    origins.set(reason, origin);
}

/** Whether `error` already carries its report header (a compile error's). */
export function hasFatalHeader(error: object): boolean {
  return headers.has(error);
}

/** Node's `arrow_message_private_symbol`: a header known when the error arose (compile errors). */
export function setFatalHeader(error: object, header: string): void {
  headers.set(error, header);
}

/** Node `IsExceptionDecorated`: the error's stack already carries its header. */
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
  const location = frameLocation(frame);
  if (location === null) {
    // `at JSON.parse (<anonymous>)`, `at async Promise.all (index 0)`, `native`.
    return /\((?:<anonymous>|native|index \d+)\)$/u.test(frame) ? 'builtin' : 'runtime';
  }
  if (location.file === '[eval]') return 'user';
  const path = filePath(location.file);
  if (path === null) return 'runtime';
  try {
    return syncMirror().existsSync(path) ? 'user' : 'runtime';
  } catch {
    return 'runtime';
  }
}

/** The stack with rifty-runtime frames dropped; a builtin frame stays when guest code called it. */
function guestStack(stack: string): { readonly text: string; readonly frames: string[] } {
  const lines = stack.split('\n');
  const first = lines.findIndex((line) => FRAME.test(line));
  if (first === -1) return { text: stack, frames: [] };
  const head = lines.slice(0, first);
  const kinds = lines.slice(first).map((line) => [line, frameKind(line)] as const);
  const frames: string[] = [];
  for (let i = 0; i < kinds.length; i += 1) {
    const entry = kinds[i] as (typeof kinds)[number];
    const line = entry[0];
    const kind = entry[1];
    if (kind === 'runtime') continue;
    if (kind === 'builtin') {
      const caller = kinds.slice(i + 1).find(([, k]) => k !== 'builtin');
      if (caller?.[1] !== 'user') continue;
    }
    frames.push(kind === 'user' ? asNodeFrame(line) : line);
  }
  return { text: head.concat(frames).join('\n'), frames };
}

const EVAL_NAMED = /^(\s+at )(async )?(new )?(?:([^\s()]+)\.)?eval(?: \[as ([^\]]+)\])? \((.*)\)$/u;

/**
 * A CJS factory frame as Node's `compileFunction` script shows it: line 1
 * columns without the shared-line prefix, and V8's `eval` name for an
 * anonymous function of eval-compiled code removed (Node: no name).
 */
function asNodeFrame(frame: string): string {
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

function parseProgram(source: string, file: string): AcornNode | null {
  const options = {
    ecmaVersion: 'latest',
    allowHashBang: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    locations: true,
  } as const;
  const esm = file.startsWith('file://') || file.endsWith('.mjs');
  try {
    return acornParse(source, { ...options, sourceType: esm ? 'module' : 'script' });
  } catch {
    return null;
  }
}

function offsetOf(source: string, line: number, column: number): number | null {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const newline = source.indexOf('\n', offset);
    if (newline === -1) return null;
    offset = newline + 1;
  }
  return offset + column;
}

function children(node: AcornNode): AcornNode[] {
  const out: AcornNode[] = [];
  const values = Object.values(node as unknown as Record<string, unknown>);
  for (let v = 0; v < values.length; v += 1) {
    const value = values[v];
    const list: unknown[] = Array.isArray(value) ? value : [value];
    for (let c = 0; c < list.length; c += 1) {
      const child = list[c];
      if (
        child !== null &&
        typeof child === 'object' &&
        typeof (child as AcornNode).type === 'string'
      )
        out.push(child as AcornNode);
    }
  }
  return out;
}

/** Nodes enclosing `offset`, outermost first. */
function enclosing(root: AcornNode, offset: number): AcornNode[] {
  const chain: AcornNode[] = [];
  let node: AcornNode | undefined = root;
  while (node !== undefined) {
    chain.push(node);
    node = children(node).find((child) => child.start <= offset && offset < child.end);
  }
  return chain;
}

/** Inside a `try` block with a `catch`: the error may be caught and thrown again elsewhere. */
function insideCatchingTry(chain: readonly AcornNode[]): boolean {
  return chain.some(
    (node, index) =>
      node.type === 'TryStatement' &&
      (node as unknown as { handler: unknown }).handler !== null &&
      chain[index + 1] === (node as unknown as { block: AcornNode }).block,
  );
}

interface HeaderSite {
  readonly file: string;
  readonly source: string;
  readonly line: number;
  readonly column: number;
}

/**
 * V8's message location as far as the source proves it. A rejection's message
 * is the error's top user frame. A throw's is its throw statement: the
 * innermost `throw` enclosing the top user frame, or that frame itself when it
 * is V8's own throw (not an error construction). Any user frame inside a
 * catching `try` may mean a rethrow elsewhere: no header.
 */
function headerSite(frames: readonly string[], origin: FatalOrigin): HeaderSite | null {
  const user = frames.filter((frame) => frameKind(frame) === 'user');
  const top = user[0] === undefined ? null : frameLocation(user[0]);
  // Only CJS factories and `-e` keep Node's coordinates (ESM: compat modules.md).
  if (top === null || (top.file !== '[eval]' && cjsLineOnePrefix(top.file) === undefined))
    return null;
  const source = readGuestSource(top.file);
  if (source === null) return null;
  if (origin === 'unhandledRejection') {
    return { file: top.file, source, line: top.line, column: top.column - 1 };
  }
  const programs = new Map<string, { readonly source: string; readonly root: AcornNode } | null>();
  const program = (file: string) => {
    if (!programs.has(file)) {
      const text = file === top.file ? source : readGuestSource(file);
      const ast = text === null ? null : parseProgram(text, file);
      programs.set(file, text === null || ast === null ? null : { source: text, root: ast });
    }
    return programs.get(file) ?? null;
  };
  for (let f = 0; f < user.length; f += 1) {
    const frame = user[f] as string;
    const location = frameLocation(frame);
    const parsed = location === null ? null : program(location.file);
    if (location === null || parsed === null) return null;
    const at = offsetOf(parsed.source, location.line, location.column - 1);
    if (at === null || insideCatchingTry(enclosing(parsed.root, at))) return null;
  }
  const root = program(top.file)?.root;
  if (root === undefined) return null;
  const offset = offsetOf(source, top.line, top.column - 1);
  if (offset === null) return null;
  const chain = enclosing(root, offset);
  let thrown: AcornNode | undefined;
  for (let n = 0; n < chain.length; n += 1) {
    if (chain[n]?.type === 'ThrowStatement') thrown = chain[n];
  }
  if (thrown?.loc != null) {
    return { file: top.file, source, line: thrown.loc.start.line, column: thrown.loc.start.column };
  }
  const at = chain.at(-1);
  if (at === undefined || at.start !== offset) return null;
  if (chain.some((node) => node.start === offset && node.type === 'NewExpression')) return null;
  return { file: top.file, source, line: top.line, column: top.column - 1 };
}

/** Node `GetErrorSource`: `<file>:<line>\n<source line>\n<caret>\n`. */
function headerText(site: HeaderSite): string {
  const text = site.source.split(/\r\n|[\n\r\u2028\u2029]/u)[site.line - 1] ?? '';
  let pad = '';
  for (let i = 0; i < site.column && i < text.length; i += 1) pad += text[i] === '\t' ? '\t' : ' ';
  return `${site.file}:${site.line}\n${text}\n${pad}^\n`;
}

function stackOf(error: object): string | null {
  try {
    const stack = (error as { stack?: unknown }).stack;
    return typeof stack === 'string' ? stack : null;
  } catch {
    return null;
  }
}

function isErrorLike(value: unknown): value is object {
  return (
    value instanceof Error ||
    (typeof value === 'object' && value !== null && stackOf(value) !== null)
  );
}

/** Node's inspect of a value inside an error's props block, at `indent` columns. */
function propValue(value: unknown, indent: number): string {
  if (isErrorLike(value)) return inspectError(value, indent);
  if (Array.isArray(value) && value.every((v) => typeof v !== 'object' || v === null)) {
    const items = value.map((v) => inspect(v));
    const start = items.length + indent + 1 + 10;
    const total = items.reduce((sum, item) => sum + item.length, items.length + start);
    if (items.length === 0) return '[]';
    if (total <= 80) return `[ ${items.join(', ')} ]`;
    const pad = ' '.repeat(indent);
    return `[\n${pad}  ${items.join(`,\n${pad}  `)}\n${pad}]`;
  }
  return inspect(value);
}

/** Node `formatError` + `reduceToSingleString` for an error at `indent` columns. */
function inspectError(error: object, indent: number): string {
  const raw = stackOf(error) ?? (reflectApply(errorToString, error, []) as string);
  let base = guestStack(raw).text;
  // Node brackets a stackless error; a runtime-decorated stack is not one.
  if (!/\n\s+at /u.test(raw) && !decorated.has(error)) base = `[${base}]`;
  if (indent > 0) base = base.replaceAll('\n', `\n${' '.repeat(indent)}`);
  const entries: string[] = [];
  const keys = objectKeys(error);
  for (let k = 0; k < keys.length; k += 1) {
    const key = keys[k] as string;
    if (key === 'stack') continue;
    const value = (error as Record<string, unknown>)[key];
    if ((key === 'name' || key === 'message') && typeof value === 'string' && raw.includes(value))
      continue;
    entries.push(`${key}: ${propValue(value, indent + 2)}`);
  }
  const hidden = ['cause', 'errors'] as const;
  for (let k = 0; k < hidden.length; k += 1) {
    const key = hidden[k] as (typeof hidden)[number];
    if (objectGetOwnPropertyDescriptor(error, key)?.enumerable === false) {
      entries.push(`[${key}]: ${propValue((error as Record<string, unknown>)[key], indent + 2)}`);
    }
  }
  if (entries.length === 0) return base;
  const single = `${base} { ${entries.join(', ')} }`;
  if (!raw.includes('\n') && !single.includes('\n') && single.length + indent <= 80) return single;
  const pad = ' '.repeat(indent);
  return `${base} {\n${pad}  ${entries.join(`,\n${pad}  `)}\n${pad}}`;
}

function primitiveText(value: unknown): string {
  return typeof value === 'symbol' ? value.toString() : String(value);
}

/** The whole fatal report for `error`, ending in the trailer's newline. */
export function formatFatalReport(error: unknown, explicit?: FatalOrigin): string {
  const origin =
    explicit ??
    ((typeof error === 'object' && error !== null && origins.get(error)) || 'uncaughtException');
  const trailer = `\nNode.js ${NODE_PROCESS_IDENTITY.version}\n`;
  if (!isErrorLike(error)) {
    const body =
      typeof error === 'object' || typeof error === 'function'
        ? inspect(error)
        : `${primitiveText(error)}\n${HINT}`;
    return `${body}\n${trailer}`;
  }
  const raw = stackOf(error) ?? '';
  // Thrown inside rifty's runtime (Node: inside its own `node:` source): V8's
  // message names that source, which has no guest counterpart — no header.
  const top = raw.split('\n').find((line) => FRAME.test(line));
  const internal = top !== undefined && frameKind(top) === 'runtime';
  const known = headers.get(error);
  const site =
    decorated.has(error) || internal || known !== undefined
      ? null
      : headerSite(guestStack(raw).frames, origin);
  const arrow = decorated.has(error)
    ? undefined
    : (known ?? (site === null ? undefined : headerText(site)));
  const header = arrow === undefined ? '' : `${arrow}\n`;
  return `${header}${inspectError(error, 0)}\n${trailer}`;
}
