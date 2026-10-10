/**
 * Named-loud process members (absent-builtin-members-loud-throws): real heap
 * statistics are not observable from the browser — `memoryUsage` exists
 * (vitest's worker init binds it) and throws `NotImplementedError` when
 * called, never fabricating numbers. Installed on the prototype so the ESM
 * static-name surface exposes it like any method.
 */
import { NotImplementedError as IoNotImplementedError } from '@riftydev/io';
import { NotImplementedError } from '@riftydev/vfs';
import {
  activeDispatchReceiver,
  installProcessLifecycleDispatcher,
} from './process-lifecycle-dispatcher.ts';

/** Real statfs needs filesystem statistics the browser cannot supply — the
 * member exists (named import links, `typeof` is 'function') and stays loud. */
export function fsStatfsSync(_path: string, _options?: unknown): never {
  throw new IoNotImplementedError('fs.statfsSync');
}

function receiver(self: unknown, NodeProcess: abstract new (...args: never[]) => unknown): unknown {
  if (self instanceof NodeProcess) return self;
  return activeDispatchReceiver(self ?? {});
}

/** Install the named-loud members. Call once at module init. */
export function installProcessAbsentMembers(
  NodeProcess: abstract new (...args: never[]) => unknown,
): void {
  installProcessLifecycleDispatcher();
  const proto = NodeProcess.prototype as unknown as Record<string, unknown>;
  proto.memoryUsage = (): never => {
    throw new NotImplementedError('process.memoryUsage');
  };
  // Named-import receiver safety: `exit`/`kill` extracted from the prototype
  // (`import { exit } from 'node:process'`) must still act on the ACTIVE
  // process — Node's methods close over the process object.
  proto.exit = function (this: unknown, code?: unknown): never {
    const self = receiver(this, NodeProcess);
    return (self as unknown as { exitForNode(code?: unknown): never }).exitForNode(code);
  };
  proto.kill = function (this: unknown, pid: number, signal?: string): boolean {
    const self = receiver(this, NodeProcess);
    return (self as unknown as { killForNode(pid: number, signal: string): boolean }).killForNode(
      pid,
      signal ?? 'SIGTERM',
    );
  };
}
