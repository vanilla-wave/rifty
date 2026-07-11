/**
 * Honest ceilings for the partial spec-seeded `process.stdin` (ADR-0230).
 *
 * The owner foreground pump now feeds the real MessagePort-backed reader, so
 * flowing `data` listeners plus setEncoding/resume/pause work. Pull-mode
 * Readable, piping, async iteration, and raw TTY mode do not; patch those
 * surfaces in place to throw NotImplementedError instead of a bare TypeError or
 * false-success no-op. Non-consume events and passive isTTY/fd remain live.
 */
import { NotImplementedError } from '@riftydev/vfs';

interface ProcessWithStdin {
  stdin?: unknown;
}

type Listenable = Record<string, unknown> & {
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  once?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  addListener?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  prependListener?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  prependOnceListener?: (event: string, listener: (...args: unknown[]) => void) => unknown;
};

const LISTENER_ADD = [
  'on',
  'once',
  'addListener',
  'prependListener',
  'prependOnceListener',
] as const;

const ALWAYS_LOUD = ['read', 'pipe', 'setRawMode'] as const;
const UNSUPPORTED_EVENTS = new Set(['readable']);

export function installStdinCapabilityGuards(proc: ProcessWithStdin): void {
  const loud = (): never => {
    throw new NotImplementedError(
      'process.stdin',
      'pull/raw stdin surface is not implemented — backlog/kernel/worker-per-process-residuals + terminal/raw-stdin-deferred-items',
    );
  };

  const stdin = proc.stdin as Listenable | undefined;
  if (!stdin || typeof stdin !== 'object') {
    // No real stdin should exist only outside the spec-seeded worker contract.
    // Keep every consume path loud there, including flowing listeners.
    const stub: Record<string | symbol, unknown> = { isTTY: false, readable: false };
    for (const m of LISTENER_ADD) stub[m] = loud;
    for (const m of ALWAYS_LOUD) stub[m] = loud;
    stub[Symbol.asyncIterator] = loud;
    try {
      proc.stdin = stub;
    } catch {
      Object.defineProperty(proc, 'stdin', { value: stub, configurable: true });
    }
    return;
  }

  // Flowing `data` is implemented. Pull-mode `readable` stays loud; delegate
  // every other event so end/close/error listeners keep working.
  for (const method of LISTENER_ADD) {
    const orig = stdin[method];
    if (typeof orig !== 'function') continue;
    const bound = orig.bind(stdin);
    stdin[method] = (event: string, ...args: unknown[]): unknown => {
      if (UNSUPPORTED_EVENTS.has(event)) return loud();
      return bound(event, ...(args as [(...a: unknown[]) => void]));
    };
  }

  // Missing pull/pipe/raw APIs remain explicit NotImplementedError ceilings.
  for (const method of ALWAYS_LOUD) {
    (stdin as Record<string, unknown>)[method] = loud;
  }
  (stdin as Record<symbol, unknown>)[Symbol.asyncIterator] = loud;
}
