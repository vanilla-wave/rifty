import {
  Buffer,
  type Encoding,
  type EventEmitter,
  NotImplementedError,
  type Readable,
} from '@riftydev/io';

const DEFAULT_MAX_BUFFER = 1024 * 1024;

export interface BufferedExecutionOptions {
  readonly encoding?: unknown;
  readonly killSignal?: unknown;
  readonly maxBuffer?: unknown;
  readonly timeout?: unknown;
}

export interface NormalizedBufferedExecutionOptions {
  readonly encoding: string | null;
  readonly killSignal: string;
  readonly maxBuffer: number;
  readonly timeout: number;
}

export type BufferedExecutionOutput = string | Buffer;

export type BufferedExecutionCallback = (
  error: Error | null,
  stdout: BufferedExecutionOutput,
  stderr: BufferedExecutionOutput,
) => void;

interface BufferedChildProcess {
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  readonly killed: boolean;
  kill(signal?: string): boolean;
  on: EventEmitter['on'];
}

interface OutputAccumulator {
  readonly chunks: (string | Buffer)[];
  length: number;
}

type BufferedExecutionError = Error & {
  code?: number | string | null;
  killed?: boolean;
  signal?: string | null;
  cmd?: string;
};

export function normalizeBufferedExecutionOptions(
  options: BufferedExecutionOptions,
): NormalizedBufferedExecutionOptions {
  const timeout = options.timeout ?? 0;
  if (!Number.isInteger(timeout) || (timeout as number) < 0) {
    throw nodeRangeError('timeout', 'an unsigned integer', timeout);
  }

  const requestedMaxBuffer =
    options.maxBuffer === undefined ? DEFAULT_MAX_BUFFER : options.maxBuffer;
  const maxBuffer = requestedMaxBuffer === null ? 0 : requestedMaxBuffer;
  if (typeof maxBuffer !== 'number' || !(maxBuffer >= 0)) {
    throw nodeRangeError('options.maxBuffer', 'a positive number', maxBuffer);
  }

  const requestedKillSignal = options.killSignal ?? 'SIGTERM';
  if (typeof requestedKillSignal !== 'string' && typeof requestedKillSignal !== 'number') {
    throw nodeTypeError('options.killSignal', 'string or number', requestedKillSignal);
  }
  const killSignal =
    requestedKillSignal === 15 ||
    (typeof requestedKillSignal === 'string' && requestedKillSignal.toUpperCase() === 'SIGTERM')
      ? 'SIGTERM'
      : requestedKillSignal;
  if (killSignal !== 'SIGTERM') {
    throw new NotImplementedError(
      'child_process.execFile.killSignal',
      `buffered execution with killSignal ${killSignal}`,
    );
  }

  const requestedEncoding = options.encoding === undefined ? 'utf8' : options.encoding;
  const encoding =
    requestedEncoding !== 'buffer' && Buffer.isEncoding(requestedEncoding)
      ? String(requestedEncoding)
      : null;
  return { encoding, killSignal, maxBuffer, timeout: timeout as number };
}

export function collectChildProcessOutput(
  child: BufferedChildProcess,
  command: string,
  args: readonly string[],
  options: NormalizedBufferedExecutionOptions,
  callback?: BufferedExecutionCallback,
): void {
  const stdout: OutputAccumulator = { chunks: [], length: 0 };
  const stderr: OutputAccumulator = { chunks: [], length: 0 };
  let executionError: BufferedExecutionError | null = null;
  let killedByCollector = false;
  let collecting = true;
  let exited = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const cmd = args.length === 0 ? command : `${command} ${args.join(' ')}`;

  const finish = (code?: number | null, signal?: string | null): void => {
    if (exited) return;
    exited = true;
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (callback === undefined) return;

    const stdoutValue = mergeOutput(stdout, options.encoding);
    const stderrValue = mergeOutput(stderr, options.encoding);
    if (executionError === null && code === 0 && signal === null) {
      callback(null, stdoutValue, stderrValue);
      return;
    }

    if (executionError === null) {
      executionError = Object.assign(new Error(`Command failed: ${cmd}\n${String(stderrValue)}`), {
        code,
        killed: child.killed || killedByCollector,
        signal,
      });
    }
    executionError.cmd = cmd;
    callback(executionError, stdoutValue, stderrValue);
  };

  const kill = (): void => {
    if (!collecting) return;
    collecting = false;
    killedByCollector = true;
    try {
      child.kill(options.killSignal);
    } catch (error) {
      executionError = asError(error);
      finish();
    }
  };

  const onChunk = (
    stream: 'stdout' | 'stderr',
    accumulator: OutputAccumulator,
    chunk: unknown,
  ): void => {
    if (!collecting) return;
    const encoded = normalizeChunk(chunk, options.encoding);
    if (options.maxBuffer === Number.POSITIVE_INFINITY) {
      accumulator.chunks.push(encoded);
      return;
    }

    const length = outputLength(encoded, options.encoding);
    accumulator.length += length;
    if (accumulator.length <= options.maxBuffer) {
      accumulator.chunks.push(encoded);
      return;
    }

    const remaining = options.maxBuffer - (accumulator.length - length);
    accumulator.chunks.push(encoded.slice(0, remaining) as string | Buffer);
    executionError = Object.assign(new RangeError(`${stream} maxBuffer length exceeded`), {
      code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
    });
    kill();
  };

  if (options.timeout > 0) timeoutId = setTimeout(kill, options.timeout);
  if (child.stdout !== null) {
    if (options.encoding !== null) child.stdout.setEncoding(options.encoding);
    child.stdout.on('data', (chunk) => onChunk('stdout', stdout, chunk));
  }
  if (child.stderr !== null) {
    if (options.encoding !== null) child.stderr.setEncoding(options.encoding);
    child.stderr.on('data', (chunk) => onChunk('stderr', stderr, chunk));
  }
  child.on('error', (error) => {
    executionError = asError(error);
    collecting = false;
    finish();
  });
  child.on('close', (code, signal) => finish(code as number | null, signal as string | null));
}

function normalizeChunk(chunk: unknown, encoding: string | null): string | Buffer {
  if (encoding !== null) {
    return typeof chunk === 'string'
      ? chunk
      : Buffer.from(chunk as Uint8Array).toString(encoding as Encoding);
  }
  return typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array);
}

function outputLength(chunk: string | Buffer, encoding: string | null): number {
  return typeof chunk === 'string'
    ? Buffer.byteLength(chunk, encoding as Encoding | undefined)
    : chunk.length;
}

function mergeOutput(accumulator: OutputAccumulator, encoding: string | null): string | Buffer {
  if (encoding !== null) return accumulator.chunks.join('');
  return Buffer.concat(accumulator.chunks as Buffer[]);
}

function nodeRangeError(name: string, expected: string, value: unknown): RangeError {
  return Object.assign(
    new RangeError(
      `The value of "${name}" is out of range. It must be ${expected}. Received ${String(value)}`,
    ),
    { code: 'ERR_OUT_OF_RANGE' },
  );
}

function nodeTypeError(name: string, expected: string, value: unknown): TypeError {
  return Object.assign(
    new TypeError(
      `The "${name}" property must be of type ${expected}. Received type ${typeof value}`,
    ),
    { code: 'ERR_INVALID_ARG_TYPE' },
  );
}

function asError(error: unknown): BufferedExecutionError {
  return error instanceof Error ? error : new Error(String(error));
}
