import { describe, expect, it } from 'vitest';
import {
  ClosedHandleError,
  ProjectBusyError,
  ProjectDefinitionMismatchError,
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

    expect(mismatch).toBeInstanceOf(ProjectDefinitionMismatchError);
    expect(busy).toBeInstanceOf(ProjectBusyError);
    expect(closed).toBeInstanceOf(ClosedHandleError);
  });

  it('keeps unknown owner failures plain while preserving their name and message', () => {
    const decoded = deserializeWorkbenchOwnerError({ name: 'ThirdPartyError', message: 'broken' });
    expect(decoded).toBeInstanceOf(Error);
    expect(decoded).not.toBeInstanceOf(ProjectBusyError);
    expect(decoded).toMatchObject({ name: 'ThirdPartyError', message: 'broken' });
  });
});
