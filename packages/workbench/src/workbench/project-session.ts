import type { ProcessExit } from '@riftydev/shell';
import { ClosedHandleError, ProjectBusyError, ProjectRunExitedBeforeReadyError } from './errors.ts';
import type { ProjectContentController } from './project-content.ts';
import type { ProjectDocuments } from './project-documents.ts';
import type { ProjectFiles } from './project-files.ts';
import type { ProjectTerminal, ProjectTerminalRun } from './project-terminal.ts';
export {
  ClosedHandleError,
  ProjectBusyError,
  ProjectRunExitedBeforeReadyError,
} from './errors.ts';

export interface ProjectRuntimeRun<TReady> {
  readonly run: ProjectTerminalRun;
  readonly ready: Promise<TReady>;
  readonly closed: Promise<void>;
}

export interface ProjectRuntime<TReady> {
  start(): ProjectRuntimeRun<TReady>;
  close(): Promise<void>;
}

export interface ProjectRun<TReady> {
  readonly terminal: ProjectTerminal;
  readonly ready: Promise<TReady>;
  readonly exited: Promise<ProcessExit>;
  stop(): Promise<ProcessExit>;
  close(): Promise<ProcessExit>;
}

export interface ProjectSession<TReady> {
  readonly files: ProjectFiles;
  readonly documents: ProjectDocuments;
  run(): ProjectRun<TReady>;
  readonly terminals: { open(): ProjectTerminal };
  close(): Promise<void>;
}

interface ProjectSessionCloseInternals {
  readonly beforeClose: Set<() => Promise<void>>;
  readonly isClosing: () => boolean;
}

const closeInternals = new WeakMap<object, ProjectSessionCloseInternals>();

function deduplicateCausalCloseErrors(errors: readonly Error[]): readonly Error[] {
  const unique = errors.filter((error, index) => errors.indexOf(error) === index);
  const reported = new Set(unique);
  return unique.filter((error) => {
    if (!(error instanceof AggregateError)) return true;
    const causes = error.errors as readonly unknown[];
    return (
      causes.length === 0 ||
      causes.some((cause) => !(cause instanceof Error) || cause === error || !reported.has(cause))
    );
  });
}

/** Package-private lifecycle hook; clean preflight always runs before these drains. */
export function registerProjectSessionBeforeClose(
  session: ProjectSession<unknown>,
  hook: () => Promise<void>,
): void {
  if (typeof hook !== 'function')
    throw new TypeError('Project session pre-close hook must be a function');
  const internals =
    typeof session === 'object' && session !== null ? closeInternals.get(session) : undefined;
  if (internals === undefined) throw new TypeError('Invalid or forged ProjectSession');
  if (internals.isClosing()) throw new ClosedHandleError('Project session');
  internals.beforeClose.add(hook);
}

export function createProjectSession<TReady>(_options: {
  readonly content: ProjectContentController;
  readonly runtime: ProjectRuntime<TReady>;
  readonly terminal: ProjectTerminal;
  readonly createTerminal: () => ProjectTerminal;
  /** Physical owner teardown, admitted only after synchronous content preflight. */
  readonly closeOwner?: () => Promise<void>;
}): ProjectSession<TReady> {
  const { content, runtime, terminal, createTerminal, closeOwner } = _options;
  const terminals: ProjectTerminal[] = [terminal];
  let runClaimed = false;
  let activeRun: ProjectRun<TReady> | null = null;
  let closing = false;
  let closed = false;
  let closePromise: Promise<void> | null = null;
  const beforeClose = new Set<() => Promise<void>>();

  const assertOpen = (): void => {
    if (closing || closed) throw new ClosedHandleError('Project session');
  };

  const errorFrom = (error: unknown): Error =>
    error instanceof Error ? error : new Error(String(error));

  const deferred = <T>(): {
    readonly promise: Promise<T>;
    readonly resolve: (value: T) => void;
    readonly reject: (error: Error) => void;
  } => {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    void promise.catch(() => {});
    return { promise, resolve, reject };
  };

  const session: ProjectSession<TReady> = {
    files: content.files,
    documents: content.documents,

    run() {
      assertOpen();
      if (runClaimed) throw new ProjectBusyError('Project session');
      runClaimed = true;
      let started: ProjectRuntimeRun<TReady>;
      try {
        started = runtime.start();
      } catch (error) {
        runClaimed = false;
        throw error;
      }
      void started.closed.catch(() => {});

      let runClosePromise: Promise<ProcessExit> | null = null;
      const ready = Promise.race([
        started.ready,
        started.run.exited.then((exit) => {
          throw new ProjectRunExitedBeforeReadyError(exit);
        }),
      ]);
      void ready.catch(() => {});
      const run: ProjectRun<TReady> = {
        terminal,
        ready,
        exited: started.run.exited,
        stop: () => started.run.stop(),
        close() {
          if (runClosePromise !== null) return runClosePromise;
          const closeOutcome = deferred<ProcessExit>();
          runClosePromise = closeOutcome.promise;
          let terminalClose: Promise<ProcessExit>;
          try {
            terminalClose = started.run.close();
          } catch (error) {
            terminalClose = Promise.reject(errorFrom(error));
          }
          void Promise.allSettled([terminalClose, started.closed]).then((results) => {
            if (activeRun === run) activeRun = null;
            runClaimed = false;
            const errors = results.flatMap((result) =>
              result.status === 'rejected' ? [errorFrom(result.reason)] : [],
            );
            if (errors.length === 1) {
              closeOutcome.reject(errors[0] as Error);
              return;
            }
            if (errors.length > 1) {
              closeOutcome.reject(
                new AggregateError(errors, errors.map((error) => error.message).join('; ')),
              );
              return;
            }
            const terminalResult = results[0];
            if (terminalResult?.status !== 'fulfilled') {
              closeOutcome.reject(new Error('Project run close lost its terminal result'));
              return;
            }
            closeOutcome.resolve(terminalResult.value);
          });
          return closeOutcome.promise;
        },
      };
      activeRun = run;
      return run;
    },

    terminals: Object.freeze({
      open() {
        assertOpen();
        const opened = createTerminal();
        terminals.push(opened);
        return opened;
      },
    }),

    close() {
      if (closePromise !== null) return closePromise;
      const closeOutcome = deferred<void>();
      closePromise = closeOutcome.promise;
      try {
        content.preflightClose();
      } catch (error) {
        closeOutcome.reject(errorFrom(error));
        void closeOutcome.promise.catch(() => {
          if (!closing && closePromise === closeOutcome.promise) closePromise = null;
        });
        return closeOutcome.promise;
      }

      closing = true;
      void (async () => {
        const errors: Error[] = [];
        const operations: Promise<unknown>[] = [];
        const start = <T>(operation: () => Promise<T>): Promise<T> => {
          try {
            return operation();
          } catch (error) {
            return Promise.reject(errorFrom(error));
          }
        };
        const hooks = [...beforeClose];
        beforeClose.clear();
        if (hooks.length > 0) {
          const hookResults = await Promise.allSettled(hooks.map((hook) => start(hook)));
          errors.push(
            ...hookResults.flatMap((result) =>
              result.status === 'rejected' ? [errorFrom(result.reason)] : [],
            ),
          );
        }
        // Start every admitted teardown synchronously after preflight. A lost
        // handed-off VFS terminal needs owner-close/disconnect to settle; it
        // cannot be awaited before physical owner teardown starts.
        operations.push(start(() => content.close()));
        for (const owned of terminals) {
          operations.push(start(() => owned.close()));
        }
        operations.push(start(() => runtime.close()));
        // Terminal close frames are synchronously enqueued before the owner
        // token is retired. Dirty preflight never reaches this hook.
        if (closeOwner !== undefined) operations.push(start(closeOwner));
        const results = await Promise.allSettled(operations);
        errors.push(
          ...results.flatMap((result) =>
            result.status === 'rejected' ? [errorFrom(result.reason)] : [],
          ),
        );
        const reportedErrors = deduplicateCausalCloseErrors(errors);
        activeRun = null;
        runClaimed = false;
        closed = true;
        if (reportedErrors.length === 1) {
          closeOutcome.reject(reportedErrors[0] as Error);
          return;
        }
        if (reportedErrors.length > 1) {
          closeOutcome.reject(
            new AggregateError(
              reportedErrors,
              reportedErrors.map((error) => error.message).join('; '),
            ),
          );
          return;
        }
        closeOutcome.resolve(undefined);
      })();
      return closeOutcome.promise;
    },
  };

  closeInternals.set(session, { beforeClose, isClosing: () => closing || closed });

  return session;
}
