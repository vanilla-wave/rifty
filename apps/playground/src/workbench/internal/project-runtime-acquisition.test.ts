import { describe, expect, it } from 'vitest';
import { createProjectRuntimeAcquisitionController } from './project-runtime-acquisition.ts';

describe('project runtime acquisition', () => {
  it('switches every later runtime line from deferred install to the requested command', () => {
    const controller = createProjectRuntimeAcquisitionController({
      kind: 'install',
      snapshotFailures: [],
    });

    expect(controller.runtime.line('vite', '/')).toBe('npm install && vite');
    controller.acceptFirstMaterializationConsumed({ sid: 'terminal-aux', rid: 'run-install' });
    expect(controller.runtime.line('vite', '/')).toBe('vite');
    expect(controller.runtime.line('node ./cli.mjs', '/')).toBe('node ./cli.mjs');
  });

  it('rejects duplicate owner evidence instead of reopening a consumed transition', () => {
    const controller = createProjectRuntimeAcquisitionController({
      kind: 'install',
      snapshotFailures: [],
    });
    controller.acceptFirstMaterializationConsumed({ sid: 'terminal-1', rid: 'run-1' });

    expect(() =>
      controller.acceptFirstMaterializationConsumed({ sid: 'terminal-2', rid: 'run-2' }),
    ).toThrow(/repeated first-materialization evidence.*terminal-1\/run-1/i);
  });

  it('rejects owner consumption without a deferred install plan', () => {
    const controller = createProjectRuntimeAcquisitionController(undefined);

    expect(() =>
      controller.acceptFirstMaterializationConsumed({ sid: 'terminal-1', rid: 'run-1' }),
    ).toThrow(/without an install plan/i);
    expect(controller.runtime.line('vite', '/')).toBe('vite');
  });
});
