import type { ProcessExit } from '@riftydev/shell';

export class ProjectBusyError extends Error {
  constructor(scope: string) {
    super(`ProjectBusyError: ${scope} already has an active run`);
    this.name = 'ProjectBusyError';
  }
}

export class ClosedHandleError extends Error {
  constructor(scope: string, cause?: unknown) {
    super(`ClosedHandleError: ${scope} is closed`);
    this.name = 'ClosedHandleError';
    this.cause = cause;
  }
}

export class ProjectDefinitionMismatchError extends Error {
  constructor(id: string) {
    super(
      `ProjectDefinitionMismatchError: project ${JSON.stringify(id)} has a different definition`,
    );
    this.name = 'ProjectDefinitionMismatchError';
  }
}

export class ProjectRunExitedBeforeReadyError extends Error {
  readonly exit: ProcessExit;

  constructor(exit: ProcessExit) {
    super(
      `Project run exited before readiness with code ${String(exit.code)} and signal ${String(exit.signal)}`,
    );
    this.name = 'ProjectRunExitedBeforeReadyError';
    this.exit = exit;
  }
}

export class StdinClosedError extends Error {
  constructor() {
    super('Terminal stdin is closed');
    this.name = 'StdinClosedError';
  }
}

export interface SerializedWorkbenchOwnerError {
  readonly name: string;
  readonly message: string;
}

/** Clone-safe owner failure payload; protocol inspection owns field validation. */
export function serializeWorkbenchOwnerError(error: unknown): SerializedWorkbenchOwnerError {
  if (error instanceof Error) {
    return Object.freeze({
      name: error.name.length > 0 ? error.name : 'Error',
      message: error.message,
    });
  }
  return Object.freeze({ name: 'Error', message: String(error) });
}

/** Restore owner-crossing public domain prototypes without guessing constructor data. */
export function deserializeWorkbenchOwnerError(value: SerializedWorkbenchOwnerError): Error {
  const error = new Error(value.message);
  const prototype =
    value.name === 'ProjectDefinitionMismatchError'
      ? ProjectDefinitionMismatchError.prototype
      : value.name === 'ProjectBusyError'
        ? ProjectBusyError.prototype
        : value.name === 'ClosedHandleError'
          ? ClosedHandleError.prototype
          : Error.prototype;
  Object.setPrototypeOf(error, prototype);
  error.name = value.name;
  return error;
}
