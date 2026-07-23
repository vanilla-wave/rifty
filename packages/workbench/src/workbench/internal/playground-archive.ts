import type { FsSync } from '@riftydev/vfs';
import { isAbsolute, normalizePath } from '@riftydev/vfs';

const MEBIBYTE = 1024 * 1024;
const DERIVED_DIRECTORY_SEGMENTS = new Set(['node_modules', '.vite', 'dist']);
const PRIVATE_ROOT_SEGMENT = '.rifty';
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export interface PlaygroundArchiveV1Limits {
  readonly maxJsonCodeUnits: number;
  readonly maxTraversalEntries: number;
  readonly maxPathSegments: number;
  readonly maxFiles: number;
  readonly maxDecodedFileBytes: number;
  readonly maxTotalDecodedBytes: number;
}

export const PLAYGROUND_ARCHIVE_V1_LIMITS: PlaygroundArchiveV1Limits = Object.freeze({
  maxJsonCodeUnits: 48 * MEBIBYTE,
  maxTraversalEntries: 20_000,
  maxPathSegments: 256,
  maxFiles: 10_000,
  maxDecodedFileBytes: 16 * MEBIBYTE,
  maxTotalDecodedBytes: 32 * MEBIBYTE,
});

interface PlaygroundArchiveFileV1 {
  readonly path: string;
  readonly encoding: 'base64';
  readonly content: string;
}

interface PlaygroundArchiveV1 {
  readonly version: 1;
  readonly root: '/';
  readonly files: readonly PlaygroundArchiveFileV1[];
}

export interface PlaygroundArchiveImportCodec {
  parseJson(json: string): unknown;
  decodeCanonicalBase64(content: string): Uint8Array;
}

export interface PreparedPlaygroundArchiveV1Import {
  /** Owner-private materialization view; every call returns fresh bytes. */
  decodedFiles(): readonly { readonly path: string; readonly bytes: Uint8Array }[];
}

interface DecodedArchiveFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertLimits(limits: PlaygroundArchiveV1Limits): void {
  const keys = [
    'maxJsonCodeUnits',
    'maxTraversalEntries',
    'maxPathSegments',
    'maxFiles',
    'maxDecodedFileBytes',
    'maxTotalDecodedBytes',
  ] as const;
  for (const key of keys) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`Playground archive ${key} must be a non-negative safe integer`);
    }
  }
}

function assertProjectRoot(fs: FsSync, root: string, requireExisting: boolean): string {
  if (
    typeof root !== 'string' ||
    root === '/' ||
    !isAbsolute(root) ||
    root.includes('\0') ||
    normalizePath(root) !== root
  ) {
    throw new TypeError('Playground archive project root must be canonical and absolute');
  }
  const stat = fs.statSyncOrNull(root);
  if (requireExisting && stat?.isDirectory !== true) {
    throw new TypeError('Playground archive export root must be an existing directory');
  }
  if (stat?.isFile === true)
    throw new TypeError('Playground archive project root cannot be a file');
  return root;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    const end = Math.min(offset + 0x8000, bytes.byteLength);
    for (let index = offset; index < end; index += 1) {
      binary += String.fromCharCode(bytes[index] ?? 0);
    }
  }
  return btoa(binary);
}

function defaultDecodeCanonicalBase64(content: string): Uint8Array {
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

const DEFAULT_IMPORT_CODEC: PlaygroundArchiveImportCodec = Object.freeze({
  parseJson: (json: string) => JSON.parse(json) as unknown,
  decodeCanonicalBase64: defaultDecodeCanonicalBase64,
});

function exactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || keys.some((key) => typeof key !== 'string')) return false;
  const actual = new Set(keys as string[]);
  return expected.every((key) => actual.has(key));
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function dataValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !('value' in descriptor)) {
    throw new TypeError(`Playground archive ${key} must be a data property`);
  }
  return descriptor.value;
}

function assertPortableRelativePath(
  path: string,
  limits: PlaygroundArchiveV1Limits,
): readonly string[] {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\') || path.includes('\0')) {
    throw new TypeError(`Playground archive path is not normalized: ${JSON.stringify(path)}`);
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new TypeError(`Playground archive path is not normalized: ${JSON.stringify(path)}`);
  }
  if (segments.length > limits.maxPathSegments) {
    throw new RangeError('Playground archive path segment limit exceeded');
  }
  const normalized = normalizePath(`/${path}`).slice(1);
  if (normalized !== path) {
    throw new TypeError(`Playground archive path is not normalized: ${JSON.stringify(path)}`);
  }
  return segments;
}

function excludedArchiveSegment(segments: readonly string[]): string | undefined {
  if (segments[0] === PRIVATE_ROOT_SEGMENT) return PRIVATE_ROOT_SEGMENT;
  return segments.find((segment) => DERIVED_DIRECTORY_SEGMENTS.has(segment));
}

function assertNoReservedSegment(segments: readonly string[]): void {
  const excluded = excludedArchiveSegment(segments);
  if (excluded !== undefined) {
    throw new TypeError(
      `Playground archive path uses reserved segment ${JSON.stringify(excluded)}`,
    );
  }
}

function decodedBase64Size(content: string): number {
  if (content.length === 0) return 0;
  if (
    content.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)
  ) {
    throw new TypeError('Playground archive content must be canonical padded base64');
  }
  const padding = content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0;
  if (padding === 2) {
    const value = BASE64_ALPHABET.indexOf(content[content.length - 3] ?? '');
    if (value < 0 || (value & 0b1111) !== 0) {
      throw new TypeError('Playground archive content must be canonical padded base64');
    }
  } else if (padding === 1) {
    const value = BASE64_ALPHABET.indexOf(content[content.length - 2] ?? '');
    if (value < 0 || (value & 0b11) !== 0) {
      throw new TypeError('Playground archive content must be canonical padded base64');
    }
  }
  return (content.length / 4) * 3 - padding;
}

function parsedArchiveFiles(
  value: unknown,
  limits: PlaygroundArchiveV1Limits,
): readonly { readonly path: string; readonly content: string; readonly decodedSize: number }[] {
  if (!plainRecord(value) || !exactKeys(value, ['version', 'root', 'files'])) {
    throw new TypeError('Playground archive must have exact version, root, and files keys');
  }
  if (dataValue(value, 'version') !== 1) {
    throw new TypeError('Playground archive version must be 1');
  }
  if (dataValue(value, 'root') !== '/') {
    throw new TypeError('Playground archive public root must be /');
  }
  const files = dataValue(value, 'files');
  if (!Array.isArray(files)) throw new TypeError('Playground archive files must be an array');
  if (files.length > limits.maxFiles)
    throw new RangeError('Playground archive file limit exceeded');

  const parsed: Array<{ path: string; content: string; decodedSize: number }> = [];
  const paths = new Set<string>();
  const topology = new Set<string>();
  let totalDecodedBytes = 0;
  for (const candidate of files) {
    if (!plainRecord(candidate) || !exactKeys(candidate, ['path', 'encoding', 'content'])) {
      throw new TypeError(
        'Playground archive file must have exact path, encoding, and content keys',
      );
    }
    const path = dataValue(candidate, 'path');
    const encoding = dataValue(candidate, 'encoding');
    const content = dataValue(candidate, 'content');
    if (typeof path !== 'string')
      throw new TypeError('Playground archive file path must be a string');
    if (encoding !== 'base64')
      throw new TypeError('Playground archive file encoding must be base64');
    if (typeof content !== 'string') {
      throw new TypeError('Playground archive file content must be a string');
    }
    const segments = assertPortableRelativePath(path, limits);
    assertNoReservedSegment(segments);
    if (paths.has(path)) throw new TypeError(`Playground archive path collision: ${path}`);
    paths.add(path);
    for (let end = 1; end <= segments.length; end += 1) {
      topology.add(segments.slice(0, end).join('/'));
      if (topology.size > limits.maxTraversalEntries) {
        throw new RangeError('Playground archive traversal entry limit exceeded');
      }
    }
    const decodedSize = decodedBase64Size(content);
    if (decodedSize > limits.maxDecodedFileBytes) {
      throw new RangeError(`Playground archive file byte limit exceeded: ${path}`);
    }
    totalDecodedBytes += decodedSize;
    if (totalDecodedBytes > limits.maxTotalDecodedBytes) {
      throw new RangeError('Playground archive total byte limit exceeded');
    }
    parsed.push({ path, content, decodedSize });
  }

  for (const path of paths) {
    const segments = path.split('/');
    for (let end = 1; end < segments.length; end += 1) {
      const ancestor = segments.slice(0, end).join('/');
      if (paths.has(ancestor)) {
        throw new TypeError(`Playground archive file-as-ancestor collision: ${ancestor}`);
      }
    }
  }
  return parsed;
}

function childPath(directory: string, name: string): string {
  return directory === '/' ? `/${name}` : `${directory}/${name}`;
}

function relativePath(root: string, path: string): string {
  if (!path.startsWith(`${root}/`)) throw new Error(`Archive export path escaped ${root}`);
  return path.slice(root.length + 1);
}

export interface BoundedPlaygroundArchiveTreeFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

interface DirectoryFrame {
  readonly directory: string;
  readonly children: ReturnType<FsSync['readdirSync']>;
  index: number;
}

function directoryFrame(fs: FsSync, directory: string): DirectoryFrame {
  return {
    directory,
    children: [...fs.readdirSync(directory)].sort((left, right) =>
      compareCodeUnits(left.name, right.name),
    ),
    index: 0,
  };
}

/** One iterative, finite tree reader shared by export and crash recovery. */
export function readBoundedPlaygroundArchiveTree(
  fs: FsSync,
  rawRoot: string,
  limits: PlaygroundArchiveV1Limits = PLAYGROUND_ARCHIVE_V1_LIMITS,
  reservedPolicy: 'exclude' | 'reject' = 'reject',
): readonly BoundedPlaygroundArchiveTreeFile[] {
  assertLimits(limits);
  const root = assertProjectRoot(fs, rawRoot, true);
  const files: BoundedPlaygroundArchiveTreeFile[] = [];
  const stack: DirectoryFrame[] = [directoryFrame(fs, root)];
  let traversalEntries = 0;
  let totalDecodedBytes = 0;

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) break;
    const child = frame.children[frame.index];
    if (child === undefined) {
      stack.pop();
      continue;
    }
    frame.index += 1;
    traversalEntries += 1;
    if (traversalEntries > limits.maxTraversalEntries) {
      throw new RangeError('Playground archive traversal entry limit exceeded');
    }

    const path = childPath(frame.directory, child.name);
    const relative = relativePath(root, path);
    const segments = assertPortableRelativePath(relative, limits);
    const reserved = excludedArchiveSegment(segments) !== undefined;
    if (reserved) {
      if (reservedPolicy === 'exclude') continue;
      assertNoReservedSegment(segments);
    }
    if (child.isDirectory) {
      stack.push(directoryFrame(fs, path));
      continue;
    }
    if (!child.isFile) throw new TypeError(`Playground archive entry is not a file: ${relative}`);
    if (files.length >= limits.maxFiles) {
      throw new RangeError('Playground archive file limit exceeded');
    }

    const stat = fs.statSync(path);
    if (!stat.isFile) throw new TypeError(`Playground archive entry changed kind: ${relative}`);
    if (
      stat.size !== undefined &&
      (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > limits.maxDecodedFileBytes)
    ) {
      if (Number.isSafeInteger(stat.size) && stat.size > limits.maxDecodedFileBytes) {
        throw new RangeError(`Playground archive file byte limit exceeded: ${relative}`);
      }
      throw new TypeError(`Playground archive file size is invalid: ${relative}`);
    }
    if (stat.size !== undefined && totalDecodedBytes + stat.size > limits.maxTotalDecodedBytes) {
      throw new RangeError('Playground archive total byte limit exceeded');
    }
    const bytes = fs.readFileBytesSync(path);
    if (bytes.byteLength > limits.maxDecodedFileBytes) {
      throw new RangeError(`Playground archive file byte limit exceeded: ${relative}`);
    }
    if (stat.size !== undefined && stat.size !== bytes.byteLength) {
      throw new Error(`Playground archive file size changed while reading: ${relative}`);
    }
    totalDecodedBytes += bytes.byteLength;
    if (totalDecodedBytes > limits.maxTotalDecodedBytes) {
      throw new RangeError('Playground archive total byte limit exceeded');
    }
    files.push(Object.freeze({ path: relative, bytes }));
  }

  files.sort((left, right) => compareCodeUnits(left.path, right.path));
  return Object.freeze(files);
}

export function exportPlaygroundArchiveV1(
  fs: FsSync,
  rawRoot: string,
  limits: PlaygroundArchiveV1Limits = PLAYGROUND_ARCHIVE_V1_LIMITS,
): string {
  assertLimits(limits);
  const files: PlaygroundArchiveFileV1[] = readBoundedPlaygroundArchiveTree(
    fs,
    rawRoot,
    limits,
    'exclude',
  ).map(({ path, bytes }) => ({ path, encoding: 'base64', content: bytesToBase64(bytes) }));
  const json = JSON.stringify({ version: 1, root: '/', files } satisfies PlaygroundArchiveV1);
  if (json.length > limits.maxJsonCodeUnits) {
    throw new RangeError('Playground archive JSON code-unit limit exceeded');
  }
  return json;
}

export function preparePlaygroundArchiveV1Import(
  fs: FsSync,
  rawRoot: string,
  json: string,
  limits: PlaygroundArchiveV1Limits = PLAYGROUND_ARCHIVE_V1_LIMITS,
  codec: PlaygroundArchiveImportCodec = DEFAULT_IMPORT_CODEC,
): PreparedPlaygroundArchiveV1Import {
  assertLimits(limits);
  assertProjectRoot(fs, rawRoot, false);
  if (typeof json !== 'string') throw new TypeError('Playground archive input must be a string');
  if (json.length > limits.maxJsonCodeUnits) {
    throw new RangeError('Playground archive JSON code-unit limit exceeded');
  }
  const parsed = parsedArchiveFiles(codec.parseJson(json), limits);
  const decoded: DecodedArchiveFile[] = parsed.map(({ path, content, decodedSize }) => {
    const bytes = codec.decodeCanonicalBase64(content);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== decodedSize) {
      throw new TypeError(`Playground archive decoder returned invalid bytes for ${path}`);
    }
    if (bytesToBase64(bytes) !== content) {
      throw new TypeError(`Playground archive content is not canonical base64 for ${path}`);
    }
    return Object.freeze({ path, bytes: bytes.slice() });
  });

  return Object.freeze({
    decodedFiles: () =>
      Object.freeze(
        decoded.map(({ path, bytes }) => Object.freeze({ path, bytes: bytes.slice() })),
      ),
  });
}
