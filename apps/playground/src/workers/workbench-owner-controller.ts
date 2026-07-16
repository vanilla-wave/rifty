import {
  ClosedHandleError,
  ProjectBusyError,
  serializeWorkbenchOwnerError,
} from '../workbench/errors.ts';
import {
  type OwnerProjectToken,
  type PageToWorkbenchOwnerMessage,
  type WorkbenchOwnerToPageMessage,
  createOwnerProjectToken,
  inspectPageToWorkbenchOwnerMessage,
} from '../workbench/owner-protocol.ts';
import {
  type InspectedProjectDefinition,
  inspectProjectDefinitionWire,
} from '../workbench/project-definition.ts';
import type {
  MaterializedProject,
  ProjectMaterializer,
} from '../workbench/project-materialization.ts';

type ProjectPtyInput = Extract<
  PageToWorkbenchOwnerMessage,
  { readonly type: 'workbench:project-pty' }
>['frame'];
type ProjectPreviewInput = Extract<
  PageToWorkbenchOwnerMessage,
  { readonly type: 'workbench:project-preview' }
>['frame'];
type ProjectVfsInput = Extract<
  PageToWorkbenchOwnerMessage,
  { readonly type: 'workbench:project-vfs' }
>['frame'];
type ProjectPtyOutput = Extract<
  WorkbenchOwnerToPageMessage,
  { readonly type: 'workbench:project-pty' }
>['frame'];
type ProjectPreviewOutput = Extract<
  WorkbenchOwnerToPageMessage,
  { readonly type: 'workbench:project-preview' }
>['frame'];
type ProjectVfsOutput = Extract<
  WorkbenchOwnerToPageMessage,
  { readonly type: 'workbench:project-vfs' }
>['frame'];

/** Token-free project ingress. The controller is the sole correlation authority. */
export type WorkbenchOwnerProjectRuntimeFrame =
  | { readonly type: 'pty'; readonly frame: ProjectPtyInput }
  | { readonly type: 'preview'; readonly frame: ProjectPreviewInput }
  | { readonly type: 'vfs'; readonly frame: ProjectVfsInput };

/** Token-free project egress. The controller adds its current owner-minted token. */
export type WorkbenchOwnerProjectRuntimeOutput =
  | { readonly type: 'pty'; readonly frame: ProjectPtyOutput }
  | { readonly type: 'preview'; readonly frame: ProjectPreviewOutput }
  | { readonly type: 'vfs'; readonly frame: ProjectVfsOutput };

export interface WorkbenchOwnerProjectRuntime {
  handleFrame(frame: WorkbenchOwnerProjectRuntimeFrame): void | Promise<void>;
  close(): Promise<void>;
}

export interface WorkbenchOwnerProjectRuntimeInput {
  readonly definition: InspectedProjectDefinition;
  readonly materialized: MaterializedProject;
  readonly emit: (output: WorkbenchOwnerProjectRuntimeOutput) => void;
}

export interface WorkbenchOwnerControllerDependencies {
  readonly materializer: ProjectMaterializer;
  readonly createProject: (
    input: WorkbenchOwnerProjectRuntimeInput,
  ) => WorkbenchOwnerProjectRuntime | Promise<WorkbenchOwnerProjectRuntime>;
  readonly send: (message: WorkbenchOwnerToPageMessage) => void;
  /** Tests inject determinism; production defaults to the owner realm's crypto. */
  readonly generateProjectToken?: () => string;
}

export interface WorkbenchOwnerController {
  /** Strict physical IPC ingress. Operational failures are returned as protocol replies. */
  handle(message: unknown): Promise<void>;
  /** Physical bootstrap awaits this barrier before its owner entry returns. */
  readonly lifetime: Promise<void>;
}

interface ActiveProject {
  readonly token: OwnerProjectToken;
  readonly runtime: WorkbenchOwnerProjectRuntime;
  acceptingInput: boolean;
  acceptingOutput: boolean;
  closePromise: Promise<void> | null;
}

type OpenMessage = Extract<
  PageToWorkbenchOwnerMessage,
  { readonly type: 'workbench:open-project' }
>;
type CloseMessage = Extract<
  PageToWorkbenchOwnerMessage,
  { readonly type: 'workbench:close-project' }
>;
type DeleteMessage = Extract<
  PageToWorkbenchOwnerMessage,
  { readonly type: 'workbench:delete-project' }
>;
type ProjectInputMessage = Extract<
  PageToWorkbenchOwnerMessage,
  {
    readonly type: 'workbench:project-pty' | 'workbench:project-preview' | 'workbench:project-vfs';
  }
>;

/**
 * Single owner-side lifecycle chokepoint. Bootstrap owns initialization and the
 * physical process; this controller owns every subsequent project transition.
 */
export function createWorkbenchOwnerController(
  dependencies: WorkbenchOwnerControllerDependencies,
): WorkbenchOwnerController {
  const { materializer, createProject, send } = dependencies;
  const generateProjectToken =
    dependencies.generateProjectToken ?? (() => globalThis.crypto.randomUUID());
  const issuedTokens = new Set<string>();
  let operationTail = Promise.resolve();
  let active: ActiveProject | null = null;
  let poison: unknown;
  let shutdownRequested = false;
  let shutdownPromise: Promise<void> | null = null;
  let resolveLifetime!: () => void;
  let rejectLifetime!: (failure: unknown) => void;
  const lifetime = new Promise<void>((resolve, reject) => {
    resolveLifetime = resolve;
    rejectLifetime = reject;
  });
  void lifetime.catch(() => {});

  const enqueue = (operation: () => void | Promise<void>): Promise<void> => {
    const result = operationTail.then(operation);
    operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const sendFailure = (failure: unknown, opId?: string): void => {
    const error = serializeWorkbenchOwnerError(failure);
    send(
      opId === undefined
        ? { type: 'workbench:failure', error }
        : { type: 'workbench:failure', opId, error },
    );
  };

  const rejectImmediately = (failure: unknown, opId?: string): Promise<void> => {
    try {
      sendFailure(failure, opId);
      return Promise.resolve();
    } catch (sendError) {
      return Promise.reject(sendError);
    }
  };

  const closedOwnerError = (): ClosedHandleError => new ClosedHandleError('Workbench owner');
  const inactiveTokenError = (): Error => new Error('Workbench project token is not active');
  const poisonedError = (): Error => {
    const detail = serializeWorkbenchOwnerError(poison).message;
    return new Error(`Workbench owner lifecycle is poisoned: ${detail}`);
  };

  const mintProjectToken = (): OwnerProjectToken => {
    const token = createOwnerProjectToken(generateProjectToken);
    if (issuedTokens.has(token)) {
      throw new Error('Workbench owner project token generator returned a duplicate token');
    }
    issuedTokens.add(token);
    return token;
  };

  const closeProjectRuntime = (project: ActiveProject): Promise<void> => {
    project.acceptingInput = false;
    project.closePromise ??= Promise.resolve()
      .then(() => project.runtime.close())
      .finally(() => {
        project.acceptingOutput = false;
      });
    return project.closePromise;
  };

  const emitFor = (project: ActiveProject, output: WorkbenchOwnerProjectRuntimeOutput): void => {
    if (active !== project || !project.acceptingOutput) {
      throw new ClosedHandleError('Workbench project output');
    }
    if (output.type === 'pty') {
      send({
        type: 'workbench:project-pty',
        projectToken: project.token,
        frame: output.frame,
      });
      return;
    }
    if (output.type === 'preview') {
      send({
        type: 'workbench:project-preview',
        projectToken: project.token,
        frame: output.frame,
      });
      return;
    }
    send({ type: 'workbench:project-vfs', projectToken: project.token, frame: output.frame });
  };

  const performOpen = async (message: OpenMessage): Promise<void> => {
    try {
      if (shutdownRequested) throw closedOwnerError();
      if (poison !== undefined) throw poisonedError();
      if (active !== null) throw new ProjectBusyError('Workbench');

      // Recompute derived identity/storage data at the controller boundary even
      // when the physical bootstrap already applied the protocol inspector.
      const definition = inspectProjectDefinitionWire(message.definition);
      const materialized = await materializer.open(definition);
      if (shutdownRequested) throw closedOwnerError();

      const token = mintProjectToken();
      let project: ActiveProject | null = null;
      const runtime = await createProject({
        definition,
        materialized,
        emit(output) {
          if (project === null) throw new ClosedHandleError('Workbench project output');
          emitFor(project, output);
        },
      });
      project = {
        token,
        runtime,
        acceptingInput: true,
        acceptingOutput: true,
        closePromise: null,
      };
      active = project;

      if (shutdownRequested) {
        project.acceptingInput = false;
        try {
          await closeProjectRuntime(project);
          if (active === project) active = null;
        } catch (error) {
          poison = error;
        }
        throw closedOwnerError();
      }

      try {
        send({
          type: 'workbench:project-opened',
          opId: message.opId,
          projectToken: token,
          projectRoot: materialized.projectRoot,
        });
      } catch (error) {
        project.acceptingInput = false;
        try {
          await closeProjectRuntime(project);
          if (active === project) active = null;
        } catch (closeError) {
          poison = closeError;
          throw new AggregateError([error, closeError], 'Project open reply and cleanup failed');
        }
        throw error;
      }
    } catch (error) {
      sendFailure(error, message.opId);
    }
  };

  const performClose = async (message: CloseMessage, project: ActiveProject): Promise<void> => {
    try {
      await closeProjectRuntime(project);
    } catch (error) {
      poison = error;
      sendFailure(error, message.opId);
      return;
    }
    if (active === project) active = null;
    send({
      type: 'workbench:project-closed',
      opId: message.opId,
      projectToken: project.token,
    });
  };

  const performDelete = async (message: DeleteMessage): Promise<void> => {
    try {
      if (shutdownRequested) throw closedOwnerError();
      if (poison !== undefined) throw poisonedError();
      if (active !== null) throw new ProjectBusyError('Workbench');
      await materializer.delete(message.id);
      if (shutdownRequested) throw closedOwnerError();
      send({ type: 'workbench:project-deleted', opId: message.opId, id: message.id });
    } catch (error) {
      sendFailure(error, message.opId);
    }
  };

  const performProjectInput = async (
    message: ProjectInputMessage,
    project: ActiveProject,
  ): Promise<void> => {
    try {
      if (message.type === 'workbench:project-pty') {
        await project.runtime.handleFrame({ type: 'pty', frame: message.frame });
      } else if (message.type === 'workbench:project-preview') {
        await project.runtime.handleFrame({ type: 'preview', frame: message.frame });
      } else {
        await project.runtime.handleFrame({ type: 'vfs', frame: message.frame });
      }
    } catch (error) {
      sendFailure(error);
    }
  };

  const requestShutdown = (): Promise<void> => {
    if (shutdownPromise !== null) return shutdownPromise;
    shutdownRequested = true;
    if (active !== null) active.acceptingInput = false;

    shutdownPromise = enqueue(async () => {
      const failures: unknown[] = [];
      const project = active;
      if (project !== null) {
        try {
          await closeProjectRuntime(project);
          if (active === project) active = null;
        } catch (error) {
          appendUnique(failures, error);
        }
      }
      if (poison !== undefined) appendUnique(failures, poison);
      try {
        await materializer.close();
      } catch (error) {
        appendUnique(failures, error);
      }
      throwFailures(failures, 'Workbench owner shutdown failed');
    });
    void shutdownPromise.then(resolveLifetime, rejectLifetime);
    return shutdownPromise;
  };

  const handle = (value: unknown): Promise<void> => {
    let message: PageToWorkbenchOwnerMessage;
    try {
      message = inspectPageToWorkbenchOwnerMessage(value);
    } catch (error) {
      return rejectImmediately(error, recoverOperationId(value));
    }

    if (message.type === 'workbench:shutdown') return requestShutdown();
    if (shutdownRequested) return rejectImmediately(closedOwnerError(), operationId(message));
    if (message.type === 'workbench:initialize') {
      return rejectImmediately(new TypeError('Workbench owner is already initialized'));
    }
    if (message.type === 'workbench:open-project') {
      return enqueue(() => performOpen(message));
    }
    if (message.type === 'workbench:delete-project') {
      return enqueue(() => performDelete(message));
    }
    if (message.type === 'workbench:close-project') {
      if (poison !== undefined) return rejectImmediately(poisonedError(), message.opId);
      const project = active;
      if (project === null || !project.acceptingInput || project.token !== message.projectToken) {
        return rejectImmediately(inactiveTokenError(), message.opId);
      }
      // The receive turn owns the fence; no later frame can enter while close awaits.
      project.acceptingInput = false;
      return enqueue(() => performClose(message, project));
    }

    const project = active;
    if (project === null || !project.acceptingInput || project.token !== message.projectToken) {
      return rejectImmediately(inactiveTokenError());
    }
    // PTY runs may remain pending for minutes. The runtime actor owns their
    // ordering/join; lifecycle FIFO must not starve signal/stdin/resize/close.
    return performProjectInput(message, project);
  };

  return Object.freeze({ handle, lifetime });
}

function recoverOperationId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.type !== 'workbench:open-project' &&
    candidate.type !== 'workbench:close-project' &&
    candidate.type !== 'workbench:delete-project'
  ) {
    return undefined;
  }
  return typeof candidate.opId === 'string' && candidate.opId.length > 0
    ? candidate.opId
    : undefined;
}

function operationId(message: PageToWorkbenchOwnerMessage): string | undefined {
  switch (message.type) {
    case 'workbench:open-project':
    case 'workbench:close-project':
    case 'workbench:delete-project':
      return message.opId;
    default:
      return undefined;
  }
}

function appendUnique(failures: unknown[], failure: unknown): void {
  if (!failures.includes(failure)) failures.push(failure);
}

function throwFailures(failures: readonly unknown[], message: string): void {
  if (failures.length === 0) return;
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, message);
}
