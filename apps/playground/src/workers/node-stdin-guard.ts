/**
 * Loud `process.stdin` for a `node <file>` child (ADR-0154 §5, ADR-0157 §4,
 * Fidelity rule).
 *
 * The pre-entry seam gives the child ONE spec-seeded `process` whose `process.stdin`
 * is a real EventEmitter fed by its stdin MessagePort (`makeStdinReader`), but the
 * owner's node executor does NOT yet forward the terminal session's stdin to that
 * port. Without this guard a program doing `process.stdin.on('data', …)` / `readline`
 * / `setRawMode` would HANG silently waiting for input that never arrives — a silent
 * divergence the Fidelity rule forbids. So we PATCH the real stdin IN PLACE
 * (ADR-0157: no swap, so this is the same object user code reads) and make every
 * CONSUME path throw loudly. Wiring real interactive stdin (the forward pump) is
 * tracked in `backlog/kernel/worker-per-process-residuals`
 * (+ `backlog/terminal/raw-stdin-deferred-items` for setRawMode/raw-mode).
 *
 * Throwers cover the FULL consume surface so nothing silently no-ops then hangs:
 * data-listener-add (on/once/addListener/prependListener/prependOnceListener — only
 * for the `'data'` event, so `'end'`/`'close'`/defensive listeners stay live),
 * read/pipe/[Symbol.asyncIterator], and the flow/encoding controls resume/pause/
 * setEncoding/setRawMode (which the real reader implements as working no-ops/flushers
 * — they would otherwise APPEAR to work). Passive `isTTY`/`fd`/`readable` stay safe.
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

const ALWAYS_LOUD = ['read', 'pipe', 'resume', 'pause', 'setEncoding', 'setRawMode'] as const;

export function installLoudStdin(proc: ProcessWithStdin): void {
  const loud = (): never => {
    throw new NotImplementedError(
      'process.stdin',
      'interactive stdin for `node <file>` is not wired — backlog/kernel/worker-per-process-residuals',
    );
  };

  const stdin = proc.stdin as Listenable | undefined;
  if (!stdin || typeof stdin !== 'object') {
    // No real stdin to guard (shouldn't happen under ADR-0157) — install a stub so
    // a consume call still throws loudly rather than a bare TypeError.
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

  // Listener-add methods: throw only for the consume event `'data'`; delegate other
  // events to the original so `'end'`/`'close'`/`'error'` listeners keep working.
  for (const method of LISTENER_ADD) {
    const orig = stdin[method];
    if (typeof orig !== 'function') continue;
    const bound = orig.bind(stdin);
    stdin[method] = (event: string, ...args: unknown[]): unknown => {
      if (event === 'data') return loud();
      return bound(event, ...(args as [(...a: unknown[]) => void]));
    };
  }

  // Readable + flow/encoding consume surface: always loud (the real reader's
  // resume=flush / pause/setEncoding no-ops would otherwise silently "succeed").
  for (const method of ALWAYS_LOUD) {
    (stdin as Record<string, unknown>)[method] = loud;
  }
  (stdin as Record<symbol, unknown>)[Symbol.asyncIterator] = loud;
}
