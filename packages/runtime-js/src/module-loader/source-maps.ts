const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUES = new Map([...BASE64].map((char, index) => [char, index] as const));
const INLINE_SOURCE_MAP_RE =
  /(?:\/\/[@#]\s*sourceMappingURL=data:application\/json(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=]+)\s*)$/;

export interface ExtractedSourceMap {
  readonly code: string;
  readonly map?: DecodedSourceMap;
}

export interface DecodedSourceMap {
  readonly lines: readonly (readonly SourceMapSegment[])[];
}

interface SourceMapEntry {
  map?: DecodedSourceMap;
  lineMap?: readonly number[];
}

interface SourceMapSegment {
  readonly generatedColumn: number;
  readonly originalLine: number;
  readonly originalColumn: number;
}

interface RawSourceMap {
  readonly version: number;
  readonly mappings: string;
}

interface StackFrameLike {
  toString(): string;
}

type PrepareStackTrace = (err: Error, stackTraces: readonly StackFrameLike[]) => unknown;
type ErrorWithPrepareStackTrace = ErrorConstructor & {
  prepareStackTrace?: PrepareStackTrace;
};

export class SourceMapRegistry {
  readonly #entries = new Map<string, SourceMapEntry>();

  set(id: string, map: DecodedSourceMap): void {
    this.#entries.set(id, { ...this.#entries.get(id), map });
  }

  setGeneratedLineMap(id: string, lineMap: readonly number[]): void {
    this.#entries.set(id, { ...this.#entries.get(id), lineMap });
  }

  delete(id: string): void {
    this.#entries.delete(id);
  }

  clear(): void {
    this.#entries.clear();
  }

  has(id: string): boolean {
    return this.#entries.get(id)?.map !== undefined;
  }

  remapStack(stack: string, id: string, lineOffset: number): string {
    const entry = this.#entries.get(id);
    if (!entry?.map) return stack;
    return remapStack(stack, id, entry, lineOffset);
  }
}

interface ActiveSourceMap {
  readonly token: symbol;
  readonly registry: SourceMapRegistry;
  readonly id: string;
  readonly lineOffset: number;
}

const activeSourceMaps: ActiveSourceMap[] = [];
let previousPrepareStackTrace: PrepareStackTrace | undefined;

const dispatcherPrepareStackTrace: PrepareStackTrace = (err, stackTraces) => {
  const rendered = previousPrepareStackTrace
    ? String(previousPrepareStackTrace(err, stackTraces))
    : renderDefaultStack(err, stackTraces);
  return remapActiveStack(rendered);
};

export function extractInlineSourceMap(source: string): ExtractedSourceMap {
  const match = INLINE_SOURCE_MAP_RE.exec(source);
  if (!match) return { code: source };
  try {
    const rawMap = decodeRawSourceMap(match[1] ?? '');
    return {
      code: source.slice(0, match.index).trimEnd(),
      map: decodeSourceMap(rawMap),
    };
  } catch {
    // Stack remapping is a DX layer: a malformed inline map must not turn
    // into a module-load failure — run the module with unmapped stacks.
    return { code: source };
  }
}

export async function withStackRemapping<T>(
  registry: SourceMapRegistry | undefined,
  id: string,
  lineOffset: number,
  fn: () => Promise<T>,
): Promise<T> {
  if (!registry?.has(id)) return fn();

  const token = Symbol(id);
  installStackDispatcher();
  activeSourceMaps.push({ token, registry, id, lineOffset });

  try {
    return await fn();
  } catch (err) {
    materializeErrorStack(err);
    throw err;
  } finally {
    const index = activeSourceMaps.findIndex((entry) => entry.token === token);
    if (index >= 0) activeSourceMaps.splice(index, 1);
    restoreStackDispatcherIfIdle();
  }
}

function installStackDispatcher(): void {
  if (activeSourceMaps.length > 0) return;
  const errorCtor = Error as ErrorWithPrepareStackTrace;
  previousPrepareStackTrace = errorCtor.prepareStackTrace;
  errorCtor.prepareStackTrace = dispatcherPrepareStackTrace;
}

function restoreStackDispatcherIfIdle(): void {
  if (activeSourceMaps.length > 0) return;
  const errorCtor = Error as ErrorWithPrepareStackTrace;
  if (errorCtor.prepareStackTrace === dispatcherPrepareStackTrace) {
    if (previousPrepareStackTrace) errorCtor.prepareStackTrace = previousPrepareStackTrace;
    else Reflect.deleteProperty(errorCtor, 'prepareStackTrace');
  }
  previousPrepareStackTrace = undefined;
}

function materializeErrorStack(err: unknown): void {
  if (!(err instanceof Error)) return;
  const stack = err.stack;
  if (typeof stack !== 'string') return;
  try {
    err.stack = stack;
  } catch {
    /* keep original stack if a host marks it read-only */
  }
}

function remapActiveStack(stack: string): string {
  const seenIds = new Set<string>();
  let out = stack;
  for (let i = activeSourceMaps.length - 1; i >= 0; i--) {
    const entry = activeSourceMaps[i];
    if (!entry || seenIds.has(entry.id)) continue;
    seenIds.add(entry.id);
    out = entry.registry.remapStack(out, entry.id, entry.lineOffset);
  }
  return out;
}

function renderDefaultStack(err: Error, stackTraces: readonly StackFrameLike[]): string {
  const title =
    err.name && err.message ? `${err.name}: ${err.message}` : err.name || err.message || 'Error';
  return [title, ...stackTraces.map((frame) => `    at ${frame.toString()}`)].join('\n');
}

function decodeRawSourceMap(encoded: string): RawSourceMap {
  const json = new TextDecoder().decode(
    Uint8Array.from(globalThis.atob(encoded), (char) => char.charCodeAt(0)),
  );
  const parsed = JSON.parse(json) as Partial<RawSourceMap>;
  if (parsed.version !== 3) throw new Error(`Unsupported source map version ${parsed.version}`);
  if (typeof parsed.mappings !== 'string') throw new Error('Source map mappings must be a string');
  return { version: parsed.version, mappings: parsed.mappings };
}

function decodeSourceMap(map: RawSourceMap): DecodedSourceMap {
  let previousSource = 0;
  let previousOriginalLine = 0;
  let previousOriginalColumn = 0;
  let previousName = 0;

  const lines = map.mappings.split(';').map((line) => {
    let previousGeneratedColumn = 0;
    const segments: SourceMapSegment[] = [];
    if (line.length === 0) return segments;
    for (const rawSegment of line.split(',')) {
      const values = decodeVlqSegment(rawSegment);
      if (values.length === 0) continue;
      const generatedColumn = previousGeneratedColumn + (values[0] ?? 0);
      previousGeneratedColumn = generatedColumn;
      // 1-field segments carry only a generated-column delta (esbuild emits
      // them for unmapped generated text); the delta above must still apply.
      if (values.length < 4) continue;
      previousSource += values[1] ?? 0;
      previousOriginalLine += values[2] ?? 0;
      previousOriginalColumn += values[3] ?? 0;
      if (values.length > 4) previousName += values[4] ?? 0;
      void previousSource;
      void previousName;
      segments.push({
        generatedColumn,
        originalLine: previousOriginalLine,
        originalColumn: previousOriginalColumn,
      });
    }
    return segments;
  });
  return { lines };
}

function decodeVlqSegment(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = BASE64_VALUES.get(char);
    if (digit === undefined) throw new Error(`Invalid source map VLQ digit '${char}'`);
    const continuation = (digit & 32) !== 0;
    value += (digit & 31) << shift;
    if (continuation) {
      shift += 5;
      continue;
    }
    const negative = (value & 1) === 1;
    values.push((negative ? -1 : 1) * (value >> 1));
    value = 0;
    shift = 0;
  }
  return values;
}

function remapStack(stack: string, id: string, entry: SourceMapEntry, lineOffset: number): string {
  const escapedId = escapeRegExp(id);
  const framePattern = new RegExp(`${escapedId}:(\\d+):(\\d+)`, 'g');
  return stack.replace(framePattern, (frame, lineText: string, columnText: string) => {
    const bodyLine = Number(lineText) - lineOffset;
    const generatedLine = entry.lineMap?.[bodyLine - 1] ?? bodyLine;
    if (generatedLine <= 0) return frame;
    const generatedColumn = Number(columnText);
    const original = entry.map
      ? lookupOriginalPosition(entry.map, generatedLine, generatedColumn)
      : undefined;
    return original ? `${id}:${original.line}:${original.column}` : frame;
  });
}

function lookupOriginalPosition(
  map: DecodedSourceMap,
  line: number,
  column: number,
): { line: number; column: number } | undefined {
  const segments = map.lines[line - 1];
  if (!segments || segments.length === 0) return undefined;
  const generatedColumn = Math.max(0, column - 1);
  let best: SourceMapSegment | undefined;
  for (const segment of segments) {
    if (segment.generatedColumn > generatedColumn) break;
    best = segment;
  }
  if (!best) return undefined;
  return { line: best.originalLine + 1, column: best.originalColumn + 1 };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
