/** `fs.Dir` (`lib/internal/fs/dir.js`). */
import { cbOf, deliver } from './fs-callback.ts';
import { fsError } from './fs-errors.ts';
import { ioTurn } from './fs-io-turn.ts';
import type { Dirent } from './fs-stats.ts';
import { runNodeCallback } from './process-lifecycle-events.ts';
import { riftyProcess } from './process.ts';

type DirCb = (err: NodeJS.ErrnoException | null, dirent?: Dirent | null) => void;

/**
 * Node's `Dir` (`lib/internal/fs/dir.js`): entries come in batches of `bufferSize`, one
 * I/O request per batch; a read the buffer answers calls back on `process.nextTick`;
 * calls made while a request is in flight wait for it (its operation queue).
 */
export class Dir implements AsyncIterable<Dirent> {
  readonly path: string;
  readonly #entries: Dirent[];
  readonly #bufferSize: number;
  #index = 0;
  #buffered: Dirent[] = [];
  #closed = false;
  #queue: (() => void)[] | null = null;

  constructor(path: string, entries: Dirent[], bufferSize = 32) {
    this.path = path;
    this.#entries = entries;
    this.#bufferSize = bufferSize;
  }

  /** The next batch (the directory handle's read); false at the end. */
  #fill(): boolean {
    const batch = this.#entries.slice(this.#index, this.#index + this.#bufferSize);
    this.#index += batch.length;
    this.#buffered.push(...batch);
    return batch.length > 0;
  }

  readSync(): Dirent | null {
    this.#assertOpen();
    if (this.#queue !== null) throw fsError('ERR_DIR_CONCURRENT_OPERATION', this.path, 'readdir');
    if (this.#buffered.length === 0 && !this.#fill()) return null;
    return this.#buffered.shift() ?? null;
  }

  read(): Promise<Dirent | null>;
  read(cb: DirCb): void;
  read(...args: [] | [unknown]) {
    if (args.length === 0 || args[0] === undefined) return this.#readPromised();
    this.#assertOpen();
    this.#read(true, cbOf(args[0], 'callback') as DirCb);
  }

  #readPromised(): Promise<Dirent | null> {
    return new Promise((resolve, reject) => {
      this.#assertOpen();
      this.#read(false, (err, dirent) => (err ? reject(err) : resolve(dirent ?? null)));
    });
  }

  #read(maybeSync: boolean, cb: DirCb): void {
    if (this.#queue !== null) {
      // A read queued behind a close never calls back (Node's queued read throws ERR_DIR_CLOSED into
      // its own drain; no callback, nothing reported).
      this.#queue.push(() => {
        if (!this.#closed) this.#read(maybeSync, cb);
      });
      return;
    }
    const buffered = this.#buffered.shift();
    if (buffered !== undefined) {
      if (maybeSync) riftyProcess.nextTick(() => runNodeCallback(cb, null, buffered));
      else cb(null, buffered);
      return;
    }
    this.#queue = [];
    const settled = (): void =>
      riftyProcess.nextTick(() => {
        const queue = this.#queue ?? [];
        this.#queue = null;
        for (const op of queue) op();
      });
    ioTurn(() => this.#fill()).then(
      (more) => {
        settled();
        runNodeCallback(cb, null, more ? (this.#buffered.shift() ?? null) : null);
      },
      (err) => {
        settled();
        runNodeCallback(cb, err as NodeJS.ErrnoException);
      },
    );
  }

  closeSync(): void {
    this.#assertOpen();
    if (this.#queue !== null) throw fsError('ERR_DIR_CONCURRENT_OPERATION', this.path, 'readdir');
    this.#closed = true;
  }

  close(): Promise<void>;
  close(cb: (err: NodeJS.ErrnoException | null) => void): void;
  close(cb?: unknown) {
    if (cb === undefined) {
      if (this.#closed) return Promise.reject(this.#closedError());
      return new Promise<void>((resolve, reject) =>
        this.close((err: NodeJS.ErrnoException | null) => (err ? reject(err) : resolve())),
      );
    }
    const done = cbOf(cb, 'callback') as (err: NodeJS.ErrnoException | null) => void;
    if (this.#closed) {
      riftyProcess.nextTick(() => runNodeCallback(done, this.#closedError()));
      return;
    }
    if (this.#queue !== null) {
      this.#queue.push(() => this.close(done));
      return;
    }
    this.#closed = true;
    deliver(
      done,
      ioTurn(() => {}),
      true,
    );
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Dirent> {
    try {
      while (true) {
        const entry = await this.#readPromised();
        if (entry === null) return;
        yield entry;
      }
    } finally {
      await this.close();
    }
  }

  #closedError(): NodeJS.ErrnoException {
    return fsError('ERR_DIR_CLOSED', this.path, 'readdir');
  }

  #assertOpen(): void {
    if (this.#closed) throw this.#closedError();
  }
}
