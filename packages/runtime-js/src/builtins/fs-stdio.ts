import { NotImplementedError } from '@riftydev/io';
import { fsError } from './fs-errors.ts';
import { checkedSliceBounds } from './fs-read-arguments.ts';
import { type StatOptions, Stats } from './fs-stats.ts';
import { runNodeCallback } from './process-lifecycle-events.ts';
import { publicNodeProcess } from './process-public.ts';

import { PROCESS_FDS, type ProcessFdSources, type StdinFdSource } from './stdio-fd-source.ts';

function descriptors(): ProcessFdSources {
  const source = (publicNodeProcess() as { [PROCESS_FDS]?: ProcessFdSources })[PROCESS_FDS];
  if (!source) throw new NotImplementedError('fs.stdio', 'process has no descriptor sources');
  return source;
}
function stdin(): StdinFdSource {
  const source = descriptors().stdin;
  if (!source) throw new NotImplementedError('fs.stdin', 'process has no descriptor input source');
  return source;
}
function assertInput(syscall: string): StdinFdSource {
  const source = stdin();
  if (source.closed) throw fsError('EBADF', undefined, syscall);
  return source;
}
export function closeStdin(): void {
  assertInput('close').close();
}
export function readStdinSync(
  buffer: Uint8Array,
  offset: number,
  length: number,
  position: number | null,
): number {
  const source = assertInput('read');
  if (position !== null) throw fsError('ESPIPE', undefined, 'read');
  const bytes = source.readSync(length);
  buffer.set(bytes, offset);
  return bytes.length;
}
export function readStdin(
  buffer: Uint8Array,
  options: { offset?: number; length?: number; position?: number | null },
  callback: (error: NodeJS.ErrnoException | null, count?: number, buffer?: Uint8Array) => void,
): void {
  const offset = options.offset ?? 0;
  const length = options.length ?? buffer.length - offset;
  checkedSliceBounds(buffer, offset, length);
  const source = assertInput('read');
  if (options.position != null && options.position !== -1)
    throw fsError('ESPIPE', undefined, 'read');
  source.read(length, (error, bytes) => {
    if (error) {
      runNodeCallback(callback, error);
      return;
    }
    buffer.set(bytes!, offset);
    runNodeCallback(callback, null, bytes!.length, buffer);
  });
}
export function writeStdio(fd: number, bytes: Uint8Array, position: number | null = null): number {
  const source = fd === 1 ? descriptors().stdout : descriptors().stderr;
  if (!source || source.closed) throw fsError('EBADF', undefined, 'write');
  if (position !== null) throw fsError('ESPIPE', undefined, 'write');
  source.write(bytes);
  return bytes.length;
}
export function statStdin(options?: StatOptions): Stats {
  assertInput('fstat');
  if (options?.bigint) throw new NotImplementedError('fs.fstatSync.bigint');
  const tty = descriptors().stdinIsTTY;
  return new Stats({
    isFile: false,
    isDirectory: false,
    size: 0,
    mtime: 0,
    atime: 0,
    nlink: 1,
    mode: (tty ? 0o20000 : 0o10000) | 0o600,
    metadata: { ino: 1, birthtime: 0, ctime: 0 },
  });
}
