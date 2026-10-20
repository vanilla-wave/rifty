import { NotImplementedError } from '@riftydev/io';
import { ref, unref } from '../internal/event-loop-keepalive.ts';
import { Buffer } from './buffer.ts';
import { type FdReadOptions, checkedSliceBounds } from './fs-read-arguments.ts';
import { publicNodeProcess } from './process-public.ts';
import { stdinInheritHook } from './process-stdin-inherit.ts';

interface ReadRequest {
  readonly buffer: Uint8Array;
  readonly offset: number;
  readonly length: number;
  resolve(count: number): void;
}

/** fd 0 consumes the existing process pipe, retaining bytes across short reads. */
class StdinFd {
  private readonly chunks: Uint8Array[] = [];
  private readonly requests: ReadRequest[] = [];
  private ended = false;

  constructor(source: object) {
    const inherit = stdinInheritHook(source);
    if (inherit === undefined)
      throw new NotImplementedError('fs.read.stdin', 'process stdin has no readable pipe');
    inherit({
      data: (chunk) => {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
        if (bytes.byteLength > 0) this.chunks.push(bytes);
        this.drain();
      },
      end: () => {
        this.ended = true;
        this.drain();
      },
    });
  }

  read(buffer: Uint8Array, offset: number, length: number): Promise<number> {
    if (length === 0) return Promise.resolve(0);
    ref();
    return new Promise<number>((resolve) => {
      this.requests.push({ buffer, offset, length, resolve });
      this.drain();
    });
  }

  private drain(): void {
    while (this.requests.length > 0 && (this.chunks.length > 0 || this.ended)) {
      const request = this.requests.shift()!;
      const chunk = this.chunks[0];
      const count = Math.min(request.length, chunk?.byteLength ?? 0);
      if (chunk !== undefined) {
        request.buffer.set(chunk.subarray(0, count), request.offset);
        if (count === chunk.byteLength) this.chunks.shift();
        else this.chunks[0] = chunk.subarray(count);
      }
      request.resolve(count);
      unref();
    }
  }
}

const readers = new WeakMap<object, StdinFd>();
export function readStandardInput(buffer: Uint8Array, options: FdReadOptions): Promise<number> {
  const offset = options.offset ?? 0;
  const length = options.length ?? buffer.byteLength - offset;
  checkedSliceBounds(buffer, offset, length);
  if (options.position !== undefined && options.position !== null && options.position !== -1) {
    throw Object.assign(new Error('ESPIPE: invalid seek, read'), {
      code: 'ESPIPE',
      errno: -29,
      syscall: 'read',
    });
  }
  if (length === 0) return Promise.resolve(0);
  const stdin = (publicNodeProcess() as { stdin: object }).stdin;
  let reader = readers.get(stdin);
  if (reader === undefined) {
    reader = new StdinFd(stdin);
    readers.set(stdin, reader);
  }
  return reader.read(buffer, offset, length);
}
