/**
 * Loud `process.stdin` for a `node <file>` child (ADR-0154 §5, Fidelity rule).
 *
 * The kernel pre-entry shim gives the child a working `process.stdin`
 * EventEmitter fed by its stdin MessagePort, but the owner's node executor does
 * NOT forward the terminal session's stdin to that port. Without this guard a
 * program doing `process.stdin.on('data', …)` / `readline` would HANG silently
 * waiting for input that never arrives — a silent divergence the Fidelity rule
 * forbids. So we make the consume surface throw loudly instead. Wiring real
 * interactive stdin is tracked in `backlog/kernel/worker-per-process-residuals`
 * (+ `backlog/terminal/raw-stdin-deferred-items`).
 *
 * Only the CONSUME methods throw; passive reads (`isTTY`, `readable`) stay safe
 * so defensive `process.stdin.isTTY` checks don't blow up.
 */
import { NotImplementedError } from '@riftydev/vfs';

interface ProcessWithStdin {
  stdin?: unknown;
}

export function installLoudStdin(proc: ProcessWithStdin): void {
  const loud = (): never => {
    throw new NotImplementedError(
      'process.stdin',
      'interactive stdin for `node <file>` is not wired — backlog/kernel/worker-per-process-residuals',
    );
  };
  const stub = {
    isTTY: false,
    readable: false,
    on: loud,
    once: loud,
    addListener: loud,
    prependListener: loud,
    read: loud,
    resume: loud,
    pipe: loud,
    [Symbol.asyncIterator]: loud,
  };
  try {
    proc.stdin = stub;
  } catch {
    // process.stdin may be a getter-only accessor on some realms.
    Object.defineProperty(proc, 'stdin', { value: stub, configurable: true });
  }
}
