import { ClosedHandleError, ProjectBusyError } from './errors.ts';
import { nodeProjectShellCommand } from './internal/node-command.ts';
import type { PreviewHandle, PreviewReadiness } from './preview-readiness.ts';
import type { ProjectRuntime } from './project-session.ts';
import {
  type ProjectTerminal,
  type ProjectTerminalRun,
  projectTerminalAdmission,
} from './project-terminal.ts';
import { createPreviewProjectRuntime } from './vite-project-runtime.ts';

interface NodeProjectRuntimeDependencies {
  readonly terminal: ProjectTerminal;
  readonly entryPath: string;
}

export interface NodeServerProjectRuntimeDependencies extends NodeProjectRuntimeDependencies {
  readonly ownerToken: string;
  readonly port: number;
  readonly createPreviewReadiness: () => PreviewReadiness;
}

export interface NodeCliProjectRuntimeDependencies extends NodeProjectRuntimeDependencies {
  readonly args: readonly string[];
}

function serverPort(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 65_535) {
    throw new RangeError('Node runtime port must be an integer from 1 to 65535');
  }
  return value as number;
}

export function createNodeServerProjectRuntime(
  dependencies: NodeServerProjectRuntimeDependencies,
): ProjectRuntime<PreviewHandle> {
  nodeProjectShellCommand(dependencies.entryPath, []);
  const port = serverPort(dependencies.port);
  return createPreviewProjectRuntime({
    terminal: dependencies.terminal,
    ownerToken: dependencies.ownerToken,
    createPreviewReadiness: dependencies.createPreviewReadiness,
    label: 'Node server project runtime',
    line: 'npm run dev',
    matches: (entry) => entry.source === 'dev-server' && entry.port === port,
  });
}

export function createNodeCliProjectRuntime(
  dependencies: NodeCliProjectRuntimeDependencies,
): ProjectRuntime<void> {
  const command = nodeProjectShellCommand(dependencies.entryPath, dependencies.args);

  type RunState = {
    readonly run: ProjectTerminalRun;
    readonly retired: Promise<void>;
  };

  const states = new Set<RunState>();
  let active: RunState | null = null;
  let closing = false;
  let closed = false;
  let closePromise: Promise<void> | null = null;

  const asError = (error: unknown): Error =>
    error instanceof Error ? error : new Error(String(error));

  return Object.freeze({
    start() {
      if (closing || closed) throw new ClosedHandleError('Node CLI project runtime');
      if (active !== null) throw new ProjectBusyError('Node CLI project runtime');

      const run = dependencies.terminal.run(command);
      const retired = run.exited.then(
        () => {
          for (const candidate of states) {
            if (candidate.run === run) states.delete(candidate);
          }
          if (active?.run === run) active = null;
        },
        (error: unknown) => {
          for (const candidate of states) {
            if (candidate.run === run) states.delete(candidate);
          }
          if (active?.run === run) active = null;
          throw asError(error);
        },
      );
      const state = { run, retired };
      states.add(state);
      active = state;
      void retired.catch(() => {});

      const ready = projectTerminalAdmission(run).then(() => undefined);
      void ready.catch(() => {});
      return Object.freeze({ run, ready, closed: retired });
    },

    close() {
      if (closePromise !== null) return closePromise;
      closing = true;
      closePromise = (async () => {
        const owned = [...states];
        const closeResults = await Promise.allSettled(
          owned.map((state) => {
            try {
              return state.run.close();
            } catch (error) {
              return Promise.reject(asError(error));
            }
          }),
        );
        const retirementResults = await Promise.allSettled(owned.map((state) => state.retired));
        const errors = [...closeResults, ...retirementResults].flatMap((result) =>
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
