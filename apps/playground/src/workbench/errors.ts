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
