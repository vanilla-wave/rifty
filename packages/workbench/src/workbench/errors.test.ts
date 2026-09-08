import { describe, expect, it } from 'vitest';
import {
  ClosedHandleError,
  ProjectBusyError,
  ProjectDefinitionMismatchError,
  SnapshotApplicationConflictError,
  deserializeWorkbenchOwnerError,
  serializeWorkbenchOwnerError,
} from './errors.ts';

describe('Workbench owner error codec', () => {
  it('restores every public domain error that can cross the owner boundary', () => {
    const mismatch = deserializeWorkbenchOwnerError(
      serializeWorkbenchOwnerError(new ProjectDefinitionMismatchError('project-a')),
    );
    const busy = deserializeWorkbenchOwnerError(
      serializeWorkbenchOwnerError(new ProjectBusyError('Workbench')),
    );
    const closed = deserializeWorkbenchOwnerError(
      serializeWorkbenchOwnerError(new ClosedHandleError('Workbench owner')),
    );
    const conflict = deserializeWorkbenchOwnerError(
      serializeWorkbenchOwnerError(
        new SnapshotApplicationConflictError(['/package-lock.json', '/node_modules/pin']),
      ),
    );

    expect(mismatch).toBeInstanceOf(ProjectDefinitionMismatchError);
    expect(busy).toBeInstanceOf(ProjectBusyError);
    expect(closed).toBeInstanceOf(ClosedHandleError);
    expect(conflict).toBeInstanceOf(SnapshotApplicationConflictError);
    expect(conflict).toMatchObject({
      name: 'SnapshotApplicationConflictError',
      paths: ['/node_modules/pin', '/package-lock.json'],
    });
  });

  it('keeps unknown owner failures plain while preserving their name and message', () => {
    const decoded = deserializeWorkbenchOwnerError({ name: 'ThirdPartyError', message: 'broken' });
    expect(decoded).toBeInstanceOf(Error);
    expect(decoded).not.toBeInstanceOf(ProjectBusyError);
    expect(decoded).toMatchObject({ name: 'ThirdPartyError', message: 'broken' });
  });
});
