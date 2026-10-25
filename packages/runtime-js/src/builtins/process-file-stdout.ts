import { NotImplementedError, Writable } from '@riftydev/io';
import type { NodeStdioWriter } from './process-stdio-writer.ts';
import { OUTPUT_FD, PROCESS_FDS, type ProcessFdSources } from './stdio-fd-source.ts';

interface FileWriterModule {
  writeSync(fd: number, bytes: Uint8Array, offset: number, length: number): number;
}

/** Keep the fs module live until first access, including across entry-bundle copies. */
export function bindFileStdoutFactory(process: object, fs: FileWriterModule): void {
  const sources = (process as { [PROCESS_FDS]?: ProcessFdSources })[PROCESS_FDS];
  if (!sources) return;
  sources.createFileStdout = () => {
    const writeSync = fs.writeSync;
    const stream = Object.assign(
      new Writable({
        write(chunk, _encoding, done) {
          const bytes = chunk as Uint8Array;
          try {
            writeSync(1, bytes, 0, bytes.length);
          } catch (error) {
            done(error as Error);
            return;
          }
          done();
        },
      }),
      { fd: 1, readable: false },
    );
    Object.defineProperty(stream, OUTPUT_FD, { value: sources.stdout });
    return stream;
  };
}

export function installLazyFileStdout(process: { stdout: NodeStdioWriter }): void {
  const sources = (process as { [PROCESS_FDS]?: ProcessFdSources })[PROCESS_FDS];
  if (sources?.stdout) sources.stdout.isFile = true;
  let stream: NodeStdioWriter | undefined;
  Object.defineProperty(process, 'stdout', {
    configurable: true,
    enumerable: true,
    get() {
      if (stream) return stream;
      const sources = (process as { [PROCESS_FDS]?: ProcessFdSources })[PROCESS_FDS];
      if (!sources?.createFileStdout) {
        throw new NotImplementedError('process.stdout.file', 'filesystem builtin is not bound');
      }
      stream = sources.createFileStdout();
      return stream;
    },
  });
}
