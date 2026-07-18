import type { PlaygroundWorkbench } from '../workbench/playground.ts';
import { rethrowAfterCleanup } from './cleanup-after-failure.ts';
import type { PlaygroundAppRuntime } from './playground-app-runtime.ts';

export interface PlaygroundAppWorkbenchOwnership {
  createRuntime(
    create: (workbench: PlaygroundWorkbench) => PlaygroundAppRuntime,
  ): PlaygroundAppRuntime;
  fail(trigger: unknown): Promise<never>;
  close(): Promise<void>;
}

/** One-way custody transfer: admitted Workbench -> App runtime -> one close. */
export function createPlaygroundAppWorkbenchOwnership(
  workbench: PlaygroundWorkbench,
): PlaygroundAppWorkbenchOwnership {
  let resource: Pick<PlaygroundWorkbench, 'close'> | Pick<PlaygroundAppRuntime, 'close'> =
    workbench;
  let runtimeCreated = false;
  let closePromise: Promise<void> | null = null;

  const close = (): Promise<void> => {
    if (closePromise !== null) return closePromise;
    try {
      closePromise = resource.close();
    } catch (error) {
      closePromise = Promise.reject(error);
    }
    void closePromise.catch(() => {});
    return closePromise;
  };

  return Object.freeze({
    createRuntime(create: (workbench: PlaygroundWorkbench) => PlaygroundAppRuntime) {
      if (runtimeCreated) throw new Error('Playground App runtime already exists');
      if (closePromise !== null) throw new Error('Playground App Workbench ownership is closing');
      const runtime = create(workbench);
      resource = runtime;
      runtimeCreated = true;
      return runtime;
    },
    fail(trigger: unknown) {
      return rethrowAfterCleanup('Playground App initialization', trigger, close);
    },
    close,
  });
}
