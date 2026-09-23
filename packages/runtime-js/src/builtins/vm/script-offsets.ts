/**
 * Host-realm `vm` script offsets (ADR-0450). A script with a non-zero
 * `lineOffset` / `columnOffset` is evaluated under a `sourceURL` identity that
 * carries its offsets and filename; one owned `Error.prepareStackTrace`
 * accessor hands every stack hook (guest or default) CallSites projected to
 * Node's positions. The ADR-0136 source-map window reads and writes the slot
 * through {@link readPrepareStackTrace} / {@link writePrepareStackTrace}.
 */

interface CallSiteLike {
  getScriptNameOrSourceURL(): unknown;
  getLineNumber(): number | null;
  getColumnNumber(): number | null;
  getEnclosingLineNumber(): number | null;
  getEnclosingColumnNumber(): number | null;
  toString(): string;
}

interface ScriptIdentity {
  readonly url: string;
  readonly filename: string;
  readonly lineOffset: number;
  readonly columnOffset: number;
}

type StackHook = (this: unknown, error: unknown, trace: unknown) => unknown;

const SCHEME = 'rifty-vm://';
const IDENTITY_RE = /^rifty-vm:\/\/(-?\d+)\/(-?\d+)\/([A-Za-z0-9._%-]*)$/;
const DEFAULT_FILENAME = 'evalmachine.<anonymous>';
const errorCtor = Error as unknown as { prepareStackTrace?: unknown };
const errorToString = Error.prototype.toString;
const arrayJoin = Array.prototype.join;

/** Unwrapped value the guest last assigned to `Error.prepareStackTrace`. */
let assigned: unknown;
const wrapperOf = new WeakMap<object, StackHook>();
const hookOf = new WeakMap<object, unknown>();
const projectedSites = new WeakSet<object>();

/**
 * `sourceURL` for a host-realm script: the filename itself for zero offsets
 * (today's shape), else an offset identity — which installs the projection.
 * A zero-offset filename that looks like an identity is encoded too, so a
 * guest name is never read back as offsets.
 */
export function hostScriptSourceURL(
  filename: string | undefined,
  lineOffset: number,
  columnOffset: number,
): string | undefined {
  const plain = filename === undefined ? undefined : String(filename);
  if (lineOffset === 0 && columnOffset === 0 && !plain?.startsWith(SCHEME)) {
    return plain || undefined;
  }
  installStackProjection();
  return `${SCHEME}${lineOffset}/${columnOffset}/${encodeFilename(plain ?? DEFAULT_FILENAME)}`;
}

/** The hook as assigned (projection wrappers unwrapped). */
export function readPrepareStackTrace(): unknown {
  return isOwnerInstalled() ? assigned : errorCtor.prepareStackTrace;
}

/** Assign the hook (`undefined` clears it) without removing the projection owner. */
export function writePrepareStackTrace(value: unknown): void {
  if (isOwnerInstalled()) {
    assigned = value;
    return;
  }
  if (value === undefined) Reflect.deleteProperty(errorCtor, 'prepareStackTrace');
  else errorCtor.prepareStackTrace = value;
}

// Node 24's default `Error.prepareStackTrace` (`ErrorPrepareStackTrace` →
// `defaultPrepareStackTrace`), fed projected CallSites.
const defaultPrepareStackTrace = {
  ErrorPrepareStackTrace(error: unknown, trace: unknown): string {
    const header = errorToString.call(error);
    const sites = projectTrace(trace) as readonly unknown[];
    return sites.length === 0 ? header : `${header}\n    at ${arrayJoin.call(sites, '\n    at ')}`;
  },
}.ErrorPrepareStackTrace;

function getPrepareStackTrace(): unknown {
  return typeof assigned === 'function'
    ? wrapperFor(assigned as StackHook)
    : defaultPrepareStackTrace;
}

function setPrepareStackTrace(value: unknown): void {
  assigned = unwrap(value);
}

function isOwnerInstalled(): boolean {
  return (
    Object.getOwnPropertyDescriptor(errorCtor, 'prepareStackTrace')?.get === getPrepareStackTrace
  );
}

/** (Re)install the owner, keeping whatever hook the slot holds now. */
function installStackProjection(): void {
  if (isOwnerInstalled()) return;
  assigned = unwrap(errorCtor.prepareStackTrace);
  Object.defineProperty(errorCtor, 'prepareStackTrace', {
    configurable: true,
    enumerable: false,
    get: getPrepareStackTrace,
    set: setPrepareStackTrace,
  });
}

function unwrap(value: unknown): unknown {
  if (value === defaultPrepareStackTrace) return undefined;
  if (typeof value === 'function' && hookOf.has(value)) return hookOf.get(value);
  return value;
}

function wrapperFor(hook: StackHook): StackHook {
  let wrapper = wrapperOf.get(hook);
  if (!wrapper) {
    wrapper = function prepareStackTrace(this: unknown, error: unknown, trace: unknown) {
      return Reflect.apply(hook, this, [error, projectTrace(trace)]);
    };
    wrapperOf.set(hook, wrapper);
    hookOf.set(wrapper, hook);
  }
  return wrapper;
}

function projectTrace(trace: unknown): unknown {
  if (!Array.isArray(trace)) return trace;
  let projected: unknown[] | undefined;
  for (let index = 0; index < trace.length; index++) {
    const site: unknown = trace[index];
    const next = projectCallSite(site);
    if (next === site) continue;
    projected ??= Array.from(trace);
    projected[index] = next;
  }
  return projected ?? trace;
}

function projectCallSite(site: unknown): unknown {
  if (typeof site !== 'object' || site === null || projectedSites.has(site)) return site;
  const callSite = site as CallSiteLike;
  if (typeof callSite.getScriptNameOrSourceURL !== 'function') return site;
  const identity = parseIdentity(callSite.getScriptNameOrSourceURL());
  if (!identity) return site;
  const proxy = new Proxy(callSite, projectionHandler(identity));
  projectedSites.add(proxy);
  return proxy;
}

function projectionHandler(identity: ScriptIdentity): ProxyHandler<CallSiteLike> {
  return {
    get(target, key) {
      switch (key) {
        case 'getLineNumber':
          return () => shiftLine(identity, target.getLineNumber());
        case 'getColumnNumber':
          return () => shiftColumn(identity, target.getLineNumber(), target.getColumnNumber());
        case 'getEnclosingLineNumber':
          return () => shiftLine(identity, target.getEnclosingLineNumber());
        case 'getEnclosingColumnNumber':
          return () =>
            shiftColumn(
              identity,
              target.getEnclosingLineNumber(),
              target.getEnclosingColumnNumber(),
            );
        case 'getScriptNameOrSourceURL':
        case 'getEvalOrigin':
          return () => identity.filename;
        case 'toString':
          return () => projectedToString(identity, target);
      }
      const value: unknown = Reflect.get(target, key, target);
      // CallSite natives check their receiver: bind them to the real CallSite.
      return typeof value === 'function' && key !== 'constructor' ? value.bind(target) : value;
    },
  };
}

// Node: line + lineOffset; column + columnOffset on physical line 1 only;
// getters return null for a shifted value <= 0.
function shiftLine(identity: ScriptIdentity, line: number | null): number | null {
  if (typeof line !== 'number') return line;
  const shifted = line + identity.lineOffset;
  return shifted > 0 ? shifted : null;
}

function shiftColumn(
  identity: ScriptIdentity,
  line: number | null,
  column: number | null,
): number | null {
  if (typeof column !== 'number') return column;
  const shifted = column + (line === 1 ? identity.columnOffset : 0);
  return shifted > 0 ? shifted : null;
}

/** Native serialization with the identity location rewritten; zero omitted, negatives printed. */
function projectedToString(identity: ScriptIdentity, target: CallSiteLike): string {
  const text = String(target.toString());
  const line = target.getLineNumber();
  const column = target.getColumnNumber();
  const raw = `${identity.url}:${line}:${column}`;
  const at = text.lastIndexOf(raw);
  // Unknown shape: keep the visible identity rather than guess a position.
  if (typeof line !== 'number' || typeof column !== 'number' || at < 0) return text;
  const shiftedLine = line + identity.lineOffset;
  const shiftedColumn = column + (line === 1 ? identity.columnOffset : 0);
  let location = identity.filename || '<anonymous>';
  if (shiftedLine !== 0) {
    location += `:${shiftedLine}`;
    if (shiftedColumn !== 0) location += `:${shiftedColumn}`;
  }
  return text.slice(0, at) + location + text.slice(at + raw.length);
}

function parseIdentity(url: unknown): ScriptIdentity | undefined {
  if (typeof url !== 'string' || !url.startsWith(SCHEME)) return undefined;
  const match = IDENTITY_RE.exec(url);
  if (!match) return undefined;
  return {
    url,
    lineOffset: Number(match[1]),
    columnOffset: Number(match[2]),
    filename: decodeFilename(match[3] ?? ''),
  };
}

// `sourceURL` values end at whitespace and reject quotes: keep [A-Za-z0-9._-],
// escape every other UTF-16 unit (lone surrogates included). No raw `/`, so an
// owner bypass never renders a plausible `/path:line:col`.
function encodeFilename(filename: string): string {
  return filename.replace(/[^A-Za-z0-9._-]/g, (char) => {
    const code = char.charCodeAt(0);
    return code < 0x100
      ? `%${code.toString(16).toUpperCase().padStart(2, '0')}`
      : `%u${code.toString(16).toUpperCase().padStart(4, '0')}`;
  });
}

function decodeFilename(encoded: string): string {
  return encoded.replace(/%u([0-9A-F]{4})|%([0-9A-F]{2})/g, (_, wide?: string, narrow?: string) =>
    String.fromCharCode(Number.parseInt(wide ?? narrow ?? '', 16)),
  );
}
