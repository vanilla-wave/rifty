/** One physical child's bounded input pipe; SAB reads and notifications share it. */
export const WORKER_INPUT_CAPACITY = 64 * 1024;

function inputError(code: 'EBADF' | 'EPIPE'): Error & { code: string } {
  return Object.assign(new Error(`worker stdin: ${code}`), { code });
}

interface PendingWrite {
  readonly bytes: Uint8Array;
  offset: number;
  readonly done: (error?: Error | null) => void;
}
interface PendingRead {
  readonly length: number;
  readonly resolve: (bytes: Uint8Array) => void;
  readonly reject: (error: Error) => void;
}

export class WorkerInput {
  readonly #chunks: Uint8Array[] = [];
  #offset = 0;
  #size = 0;
  #ended = false;
  #closed = false;
  #write: PendingWrite | null = null;
  #read: PendingRead | null = null;

  constructor(private readonly notify: () => void) {}

  write(bytes: Uint8Array, done: (error?: Error | null) => void): void {
    if (this.#closed || this.#ended) {
      done(inputError('EPIPE'));
      return;
    }
    if (this.#write !== null) throw new Error('worker stdin: concurrent writer');
    this.#write = { bytes, offset: 0, done };
    this.#fill();
    this.#wake();
  }

  end(): void {
    if (this.#closed || this.#ended) return;
    if (this.#write !== null) throw new Error('worker stdin: EOF before pending write settled');
    this.#ended = true;
    this.#wake();
  }

  read(length: number, wait: boolean): Uint8Array | null | Promise<Uint8Array> {
    if (!Number.isInteger(length) || length < 1 || length > WORKER_INPUT_CAPACITY) {
      throw new RangeError('worker stdin: invalid read length');
    }
    if (this.#closed) throw inputError('EBADF');
    if (this.#size > 0) return this.#take(length);
    if (this.#ended) return new Uint8Array();
    if (!wait) return null;
    if (this.#read !== null) throw new Error('worker stdin: concurrent reader');
    return new Promise((resolve, reject) => {
      this.#read = { length, resolve, reject };
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#chunks.length = 0;
    this.#size = 0;
    const reader = this.#read;
    const writer = this.#write;
    this.#read = null;
    this.#write = null;
    reader?.reject(inputError('EBADF'));
    writer?.done(inputError('EPIPE'));
  }

  #fill(): void {
    const writer = this.#write;
    if (!writer) return;
    const length = Math.min(
      WORKER_INPUT_CAPACITY - this.#size,
      writer.bytes.length - writer.offset,
    );
    if (length > 0) {
      this.#chunks.push(writer.bytes.slice(writer.offset, writer.offset + length));
      writer.offset += length;
      this.#size += length;
    }
    if (writer.offset === writer.bytes.length) {
      this.#write = null;
      writer.done();
    }
  }

  #take(length: number): Uint8Array {
    const chunk = this.#chunks[0];
    if (!chunk) return new Uint8Array();
    const count = Math.min(length, chunk.length - this.#offset);
    const bytes = chunk.slice(this.#offset, this.#offset + count);
    this.#offset += count;
    this.#size -= count;
    if (this.#offset === chunk.length) {
      this.#chunks.shift();
      this.#offset = 0;
    }
    this.#fill();
    return bytes;
  }

  #wake(): void {
    if (this.#read && (this.#size > 0 || this.#ended)) {
      const reader = this.#read;
      this.#read = null;
      reader.resolve(this.#take(reader.length));
    }
    try {
      this.notify();
    } catch {
      this.close();
    }
  }
}
