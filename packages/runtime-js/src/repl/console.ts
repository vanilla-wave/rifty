import { formatArgs } from './inspect.ts';

export interface ConsoleSink {
  stdout(chunk: string): void;
  stderr(chunk: string): void;
}

/**
 * Replace the global `console` with one that forwards to the given sink.
 * Returns a `restore` function to put back the original methods.
 */
export function installConsole(sink: ConsoleSink): () => void {
  const original = {
    log: console.log,
    info: console.info,
    debug: console.debug,
    warn: console.warn,
    error: console.error,
    dir: console.dir,
    trace: console.trace,
  };

  const stdoutWrite = (...args: unknown[]) => sink.stdout(`${formatArgs(args)}\n`);
  const stderrWrite = (...args: unknown[]) => sink.stderr(`${formatArgs(args)}\n`);

  console.log = stdoutWrite;
  console.info = stdoutWrite;
  console.debug = stdoutWrite;
  console.warn = stderrWrite;
  console.error = stderrWrite;
  console.dir = stdoutWrite;
  console.trace = (...args: unknown[]) => {
    const trace = new Error('Trace').stack ?? '';
    sink.stderr(`${formatArgs(args)}\n${trace}\n`);
  };

  return () => {
    console.log = original.log;
    console.info = original.info;
    console.debug = original.debug;
    console.warn = original.warn;
    console.error = original.error;
    console.dir = original.dir;
    console.trace = original.trace;
  };
}
