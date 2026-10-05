/**
 * Named-loud absent members (absent-builtin-members-loud-throws).
 * Named-loud process members: real heap
 * statistics are not observable from the browser — the members exist (vitest's
 * worker init binds `memoryUsage`) and throw `NotImplementedError` when
 * called, never fabricating numbers. Installed on the prototype so the ESM
 * static-name surface (u3) exposes them like any method.
 */
import { NotImplementedError as IoNotImplementedError } from '@riftydev/io';
import { NotImplementedError } from '@riftydev/vfs';

/** Real statfs needs filesystem statistics the browser cannot supply — the
 * member exists (named import links, `typeof` is 'function') and stays loud. */
export function fsStatfsSync(_path: string, _options?: unknown): never {
  throw new IoNotImplementedError('fs.statfsSync');
}
import {
  emitProcessExitEvent,
  installProcessLifecycleDispatcher,
} from './process-lifecycle-dispatcher.ts';

type NodeProcessShape = {
  readonly exitCode: number;
};

/** Install the named-loud members + the keepalive dispatcher. Call once at
 * module init, after the class declaration. */
export function installProcessAbsentMembers(NodeProcess: new (...args: never[]) => unknown): void {
  installProcessLifecycleDispatcher((value: unknown): boolean => value instanceof NodeProcess);
  const proto = NodeProcess.prototype as unknown as Record<string, unknown>;
  proto.memoryUsage = (): never => {
    throw new NotImplementedError('process.memoryUsage');
  };
  // Keepalive drain seam: natural loop-empty exit — `exit` once with exitCode.
  proto.emitNaturalExitEvent = function (this: NodeProcessShape): void {
    emitProcessExitEvent(this, this.exitCode);
  };
}
