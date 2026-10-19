/** Registered across the pre-entry and node-entry runtime bundle copies. */
export const STDIN_FD = Symbol.for('rifty.runtime-js.stdin-fd.v1');
export interface StdinFdSource {
  readonly closed: boolean;
  readSync(length: number): Uint8Array;
  read(length: number, callback: (error: Error | null, bytes?: Uint8Array) => void): void;
  close(): void;
}

export const OUTPUT_FD = Symbol.for('rifty.runtime-js.output-fd.v1');
export const PROCESS_FDS = Symbol.for('rifty.runtime-js.process-fds.v1');
export interface OutputFdSource {
  readonly closed: boolean;
  write(bytes: Uint8Array): void;
  close(): void;
}
export interface ProcessFdSources {
  readonly stdin?: StdinFdSource;
  readonly stdinIsTTY: boolean;
  readonly stdout?: OutputFdSource;
  readonly stderr?: OutputFdSource;
}

/** Capture descriptors before guest stream properties/methods can be replaced. */
export function captureProcessStdio(process: {
  stdin?: unknown;
  stdout: unknown;
  stderr: unknown;
}): () => void {
  const before = Object.getOwnPropertyDescriptor(process, PROCESS_FDS);
  const input = process.stdin as { [STDIN_FD]?: StdinFdSource; isTTY?: boolean } | undefined;
  const stdout = process.stdout as { [OUTPUT_FD]?: OutputFdSource };
  const stderr = process.stderr as { [OUTPUT_FD]?: OutputFdSource };
  const sources: ProcessFdSources = {
    stdin: input?.[STDIN_FD],
    stdinIsTTY: input?.isTTY === true,
    stdout: stdout[OUTPUT_FD],
    stderr: stderr[OUTPUT_FD],
  };
  Object.defineProperty(process, PROCESS_FDS, { value: sources, configurable: true });
  return () => {
    if (before) Object.defineProperty(process, PROCESS_FDS, before);
    else Reflect.deleteProperty(process, PROCESS_FDS);
  };
}
