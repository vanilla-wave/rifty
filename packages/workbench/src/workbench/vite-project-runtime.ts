import { ClosedHandleError, ProjectBusyError } from './errors.ts';
import { projectRelativePath, projectRuntimeShellWord } from './internal/node-command.ts';
import type { ProjectRuntimeAcquisition } from './internal/project-runtime-acquisition.ts';
import type { PreviewAdvertisement, PreviewHandle, PreviewReadiness } from './preview-readiness.ts';
import type { ProjectRuntime } from './project-session.ts';
import {
  type ProjectTerminal,
  type ProjectTerminalRun,
  projectTerminalAdmission,
} from './project-terminal.ts';

export interface ViteProjectRuntimeDependencies {
  readonly terminal: ProjectTerminal;
  readonly ownerToken: string;
  readonly createPreviewReadiness: () => PreviewReadiness;
  readonly port?: number;
  readonly acquisition: ProjectRuntimeAcquisition;
}

export interface PreviewProjectRuntimeDependencies extends ViteProjectRuntimeDependencies {
  readonly label: string;
  readonly line: string | (() => string);
  readonly matches: (entry: PreviewAdvertisement) => boolean;
}

function vitePort(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new RangeError('Vite runtime port must be an integer from 1 to 65535');
  }
  return value;
}

export function createPreviewProjectRuntime(
  dependencies: PreviewProjectRuntimeDependencies,
): ProjectRuntime<PreviewHandle> {
  type RunState = {
    readonly run: ProjectTerminalRun;
    readiness: PreviewReadiness | null;
    readinessClose: Promise<void> | null;
    retirement: Promise<void> | null;
    physicalSettled: boolean;
    cancelled: boolean;
  };

  const states = new Set<RunState>();
  let active: RunState | null = null;
  let closing = false;
  let closed = false;
  let closePromise: Promise<void> | null = null;

  const asError = (error: unknown): Error =>
    error instanceof Error ? error : new Error(String(error));

  const closeReadiness = (state: RunState): Promise<void> => {
    if (state.readinessClose !== null) return state.readinessClose;
    const readiness = state.readiness;
    if (readiness === null) {
      state.readinessClose = Promise.resolve();
      return state.readinessClose;
    }
    try {
      state.readinessClose = readiness.close();
    } catch (error) {
      state.readinessClose = Promise.reject(asError(error));
    }
    void state.readinessClose.catch(() => {});
    return state.readinessClose;
  };

  const retireAfterPhysicalExit = (state: RunState): Promise<void> => {
    if (state.retirement !== null) return state.retirement;
    state.physicalSettled = true;
    state.cancelled = true;
    state.retirement = (async () => {
      try {
        await closeReadiness(state);
        states.delete(state);
        if (active === state) active = null;
      } catch (error) {
        closing = true;
        throw asError(error);
      }
    })();
    void state.retirement.catch(() => {});
    return state.retirement;
  };

  const waitForRetirement = (state: RunState): Promise<void> =>
    state.run.exited.then(
      () => retireAfterPhysicalExit(state),
      () => retireAfterPhysicalExit(state),
    );

  return Object.freeze({
    start() {
      if (closing || closed) throw new ClosedHandleError(dependencies.label);
      if (active !== null) throw new ProjectBusyError(dependencies.label);

      const line = typeof dependencies.line === 'string' ? dependencies.line : dependencies.line();
      const run = dependencies.terminal.run(line);
      const state: RunState = {
        run,
        readiness: null,
        readinessClose: null,
        retirement: null,
        physicalSettled: false,
        cancelled: false,
      };
      states.add(state);
      active = state;

      const ready = projectTerminalAdmission(run).then(async (admission) => {
        if (state.cancelled || closing || closed) {
          throw new ClosedHandleError(`${dependencies.label} run`);
        }
        const readiness = dependencies.createPreviewReadiness();
        state.readiness = readiness;
        if (state.cancelled || closing || closed) {
          await closeReadiness(state);
          throw new ClosedHandleError(`${dependencies.label} run`);
        }
        return readiness.waitFor({
          ownerToken: dependencies.ownerToken,
          ptySid: admission.ptySid,
          ptyRid: admission.ptyRid,
          matches: dependencies.matches,
        });
      });
      void ready.catch(() => {});
      const runClosed = waitForRetirement(state);
      void runClosed.catch(() => {});

      return Object.freeze({ run, ready, closed: runClosed });
    },

    close() {
      if (closePromise !== null) return closePromise;
      closing = true;
      closePromise = (async () => {
        const owned = [...states];
        for (const state of owned) state.cancelled = true;

        const runClosures = owned
          .filter((state) => !state.physicalSettled)
          .map((state) => {
            try {
              return state.run.close();
            } catch (error) {
              return Promise.reject(asError(error));
            }
          });
        const runResults = await Promise.allSettled(runClosures);
        const retirementResults = await Promise.allSettled(owned.map(waitForRetirement));
        const errors = [...runResults, ...retirementResults].flatMap((result) =>
          result.status === 'rejected' ? [asError(result.reason)] : [],
        );
        active = null;
        states.clear();
        closed = true;
        if (errors.length === 1) throw errors[0] as Error;
        if (errors.length > 1) {
          throw new AggregateError(errors, errors.map((error) => error.message).join('; '));
        }
      })();
      void closePromise.catch(() => {});
      return closePromise;
    },
  });
}

export function createViteProjectRuntime(
  dependencies: ViteProjectRuntimeDependencies,
): ProjectRuntime<PreviewHandle> {
  const port = dependencies.port === undefined ? undefined : vitePort(dependencies.port);
  return createPreviewProjectRuntime({
    ...dependencies,
    label: 'Vite project runtime',
    line: () => {
      const cwd = dependencies.terminal.snapshot().cwd;
      const root = projectRelativePath('/', cwd);
      const runtimeLine = [
        'vite',
        ...(root === '.' ? [] : [projectRuntimeShellWord(root)]),
        ...(port === undefined ? [] : ['--port', String(port)]),
      ].join(' ');
      return dependencies.acquisition.line(runtimeLine, cwd);
    },
    matches: (entry) => entry.source === 'node',
  });
}
