import type {
  ProjectAcquisitionEnsureOptions,
  ProjectAcquisitionPort,
  ProjectAcquisitionRequest,
} from './project-materialization.ts';

interface ActiveAcquisitionWaiter {
  readonly controller: AbortController;
  acceptingProgress: boolean;
}

export interface ProjectAcquisitionWaiterScope {
  ensure<TAcquisition>(
    acquisition: ProjectAcquisitionPort<TAcquisition>,
    request: ProjectAcquisitionRequest,
    options?: Omit<ProjectAcquisitionEnsureOptions, 'signal'>,
  ): Promise<TAcquisition>;
  cancel(reason: unknown): void;
}

/** Owns waiter cancellation and progress lifetime without exposing a public signal. */
export function createProjectAcquisitionWaiterScope(): ProjectAcquisitionWaiterScope {
  const active = new Set<ActiveAcquisitionWaiter>();

  return Object.freeze({
    async ensure<TAcquisition>(
      acquisition: ProjectAcquisitionPort<TAcquisition>,
      request: ProjectAcquisitionRequest,
      options?: Omit<ProjectAcquisitionEnsureOptions, 'signal'>,
    ): Promise<TAcquisition> {
      const waiter: ActiveAcquisitionWaiter = {
        controller: new AbortController(),
        acceptingProgress: true,
      };
      active.add(waiter);
      try {
        return await acquisition.ensure(request, {
          ...(options?.onRuntimeAssetProgress === undefined
            ? {}
            : {
                onRuntimeAssetProgress(progress) {
                  if (waiter.acceptingProgress && !waiter.controller.signal.aborted) {
                    options.onRuntimeAssetProgress?.(progress);
                  }
                },
              }),
          signal: waiter.controller.signal,
        });
      } finally {
        waiter.acceptingProgress = false;
        active.delete(waiter);
      }
    },

    cancel(reason: unknown): void {
      for (const waiter of active) {
        waiter.acceptingProgress = false;
        waiter.controller.abort(reason);
      }
    },
  });
}
