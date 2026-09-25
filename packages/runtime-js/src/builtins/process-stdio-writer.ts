/**
 * `process.stdout`/`process.stderr` writers + TTY control shape for
 * `NodeProcess` (`process.ts`); split out of it by concern.
 */
import type { KernelStdioOutputWriter } from '@riftydev/kernel';
import { EventEmitter } from './events.ts';

// --- stdio plumbing (shared by spec + no-spec processes) ---

const STDIO_ENCODER = new TextEncoder();

function encodeChunk(chunk: string | Uint8Array): Uint8Array {
  return typeof chunk === 'string' ? STDIO_ENCODER.encode(chunk) : chunk;
}

type StdioCallback = () => void;

export interface NodeStdioWriter extends EventEmitter {
  write(chunk: string | Uint8Array): boolean;
  isTTY: boolean;
  fd: number;
  columns?: number;
  rows?: number;
  getWindowSize?(): [number, number];
  clearLine?(dir?: number, cb?: StdioCallback): boolean;
  cursorTo?(x: number, yOrCb?: number | StdioCallback, cb?: StdioCallback): boolean;
  moveCursor?(dx: number, dy: number, cb?: StdioCallback): boolean;
  clearScreenDown?(cb?: StdioCallback): boolean;
}

function writeControl(stream: NodeStdioWriter, sequence: string, cb?: StdioCallback): boolean {
  const ok = stream.write(sequence);
  if (cb) queueMicrotask(cb);
  return ok;
}

function attachTtyControls(
  stream: NodeStdioWriter,
  size: { readonly cols: number; readonly rows: number },
): NodeStdioWriter {
  stream.columns = size.cols;
  stream.rows = size.rows;
  stream.getWindowSize = () => [stream.columns ?? 0, stream.rows ?? 0];
  stream.clearLine = (dir, cb): boolean => {
    const direction = dir ?? 0;
    const mode = direction < 0 ? 1 : direction > 0 ? 0 : 2;
    return writeControl(stream, `\x1b[${mode}K`, cb);
  };
  stream.cursorTo = (x, yOrCb, cb): boolean => {
    const y = typeof yOrCb === 'number' ? yOrCb : undefined;
    const callback = typeof yOrCb === 'function' ? yOrCb : cb;
    const sequence = y === undefined ? `\x1b[${Math.max(0, x) + 1}G` : `\x1b[${y + 1};${x + 1}H`;
    return writeControl(stream, sequence, callback);
  };
  stream.moveCursor = (dx, dy, cb): boolean => {
    let sequence = '';
    if (dx < 0) sequence += `\x1b[${-dx}D`;
    else if (dx > 0) sequence += `\x1b[${dx}C`;
    if (dy < 0) sequence += `\x1b[${-dy}A`;
    else if (dy > 0) sequence += `\x1b[${dy}B`;
    return writeControl(stream, sequence, cb);
  };
  stream.clearScreenDown = (cb): boolean => writeControl(stream, '\x1b[0J', cb);
  return stream;
}

function detachTtyControls(stream: NodeStdioWriter): NodeStdioWriter {
  Reflect.deleteProperty(stream, 'columns');
  Reflect.deleteProperty(stream, 'rows');
  Reflect.deleteProperty(stream, 'getWindowSize');
  Reflect.deleteProperty(stream, 'clearLine');
  Reflect.deleteProperty(stream, 'cursorTo');
  Reflect.deleteProperty(stream, 'moveCursor');
  Reflect.deleteProperty(stream, 'clearScreenDown');
  return stream;
}

export function applyTtyShape(
  stream: NodeStdioWriter,
  isTTY: boolean,
  size: { readonly cols: number; readonly rows: number },
): void {
  stream.isTTY = isTTY;
  if (isTTY) attachTtyControls(stream, size);
  else detachTtyControls(stream);
}

/** Spec stdout/stderr writer: postMessage bytes to the child's stdio port. */
export function makeStdioWriter(
  port: KernelStdioOutputWriter,
  fd: number,
  isTTY: boolean,
  size: { readonly cols: number; readonly rows: number },
): NodeStdioWriter {
  const stream = Object.assign(new EventEmitter(), {
    isTTY,
    fd,
    write(chunk: string | Uint8Array) {
      const bytes = encodeChunk(chunk);
      // A passed-in view may share storage with its caller; the semantic writer
      // owns transport, while this adapter preserves Node's non-detaching write.
      port.write(typeof chunk === 'string' ? bytes : new Uint8Array(bytes));
      return true;
    },
  }) as NodeStdioWriter;
  return isTTY ? attachTtyControls(stream, size) : stream;
}
