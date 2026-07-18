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

type CloseOwner = Pick<PlaygroundWorkbench, 'close'> | Pick<PlaygroundAppRuntime, 'close'>;

type WorkbenchCustody =
  | { readonly state: 'workbench'; readonly owner: PlaygroundWorkbench }
  | { readonly state: 'runtime'; readonly owner: PlaygroundAppRuntime }
  | { readonly state: 'closed'; readonly owner: CloseOwner };

/** One-way custody transfer: admitted Workbench -> App runtime -> closed transfer. */
export function createPlaygroundAppWorkbenchOwnership(
  workbench: PlaygroundWorkbench,
): PlaygroundAppWorkbenchOwnership {
  let custody: WorkbenchCustody = { state: 'workbench', owner: workbench };

  const close = (): Promise<void> => {
    const owner = custody.owner;
    custody = { state: 'closed', owner };
    try {
      return owner.close();
    } catch (error) {
      return Promise.reject(error);
    }
  };

  return Object.freeze({
    createRuntime(create: (workbench: PlaygroundWorkbench) => PlaygroundAppRuntime) {
      if (custody.state === 'runtime') throw new Error('Playground App runtime already exists');
      if (custody.state === 'closed') {
        throw new Error('Playground App Workbench ownership is closing');
      }
      const runtime = create(custody.owner);
      custody = { state: 'runtime', owner: runtime };
      return runtime;
    },
    fail(trigger: unknown) {
      return rethrowAfterCleanup('Playground App initialization', trigger, close);
    },
    close,
  });
}
