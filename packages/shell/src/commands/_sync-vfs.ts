import type { FsSync, Vfs } from '@riftydev/vfs';

const enc = new TextEncoder();
const dec = new TextDecoder();
const views = new WeakMap<FsSync, Vfs>();

function assertReadWindow(options: { chunkSize?: number; start?: number; end?: number }): void {
  const { chunkSize, start, end } = options;
  if (chunkSize !== undefined && (!Number.isInteger(chunkSize) || chunkSize <= 0)) {
    throw new RangeError(`openReadable chunkSize must be a positive integer; got ${chunkSize}`);
  }
  for (const [name, value] of [
    ['start', start],
    ['end', end],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      throw new RangeError(`openReadable ${name} must be a non-negative integer; got ${value}`);
    }
  }
  if (start !== undefined && end !== undefined && end < start) {
    throw new RangeError(`openReadable window is inverted: start ${start} > end ${end}`);
  }
}

/** Async facade over one injected synchronous namespace for the Git builtin. */
export function syncVfs(fs: FsSync): Vfs {
  const existing = views.get(fs);
  if (existing) return existing;

  const vfs: Vfs = {
    async readFile(path) {
      return new Uint8Array(fs.readFileBytesSync(path));
    },
    async readFileText(path) {
      return dec.decode(fs.readFileBytesSync(path));
    },
    async writeFile(path, data) {
      fs.writeFileSync(path, typeof data === 'string' ? enc.encode(data) : new Uint8Array(data));
    },
    async readdir(path) {
      return fs.readdirSync(path);
    },
    async mkdir(path, options = {}) {
      fs.mkdirSync(path, options);
    },
    async rm(path, options = {}) {
      fs.rmSync(path, options);
    },
    async stat(path) {
      const stat = fs.statSync(path);
      if (stat.size === undefined || stat.mtime === undefined) {
        throw new Error(`injected filesystem stat lacks size or mtime: ${path}`);
      }
      return {
        isFile: stat.isFile,
        isDirectory: stat.isDirectory,
        size: stat.size,
        mtime: stat.mtime,
      };
    },
    async exists(path) {
      return fs.existsSync(path);
    },
    async utimes(path, atimeMs, mtimeMs) {
      fs.utimes(path, atimeMs, mtimeMs);
    },
    async openReadable(path, options = {}) {
      assertReadWindow(options);
      const bytes = new Uint8Array(fs.readFileBytesSync(path));
      const start = options.start ?? 0;
      const end = Math.min(options.end ?? bytes.length, bytes.length);
      const chunkSize = options.chunkSize ?? 64 * 1024;
      let offset = start;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= end) {
            controller.close();
            return;
          }
          const next = Math.min(offset + chunkSize, end);
          controller.enqueue(bytes.slice(offset, next));
          offset = next;
        },
      });
    },
  };
  views.set(fs, vfs);
  return vfs;
}
