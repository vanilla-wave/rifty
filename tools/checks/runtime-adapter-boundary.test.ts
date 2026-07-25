import { describe, expect, it } from 'vitest';
import {
  GENERIC_RUNTIME_ADAPTER_MODULES,
  runtimeAdapterBoundaryViolations,
} from './runtime-adapter-boundary.mjs';

describe('runtime adapter generic-module boundary', () => {
  it('lists the finite generic plan/admission/launch surface', () => {
    expect(GENERIC_RUNTIME_ADAPTER_MODULES).toEqual([
      'packages/npm-client/src/internal/shadow/planner.ts',
      'packages/npm-client/src/internal/shadow/manager.ts',
      'packages/npm-client/src/internal/shadow/port.ts',
      'packages/workbench/src/workers/package-acquisition-authority.ts',
      'packages/workbench/src/workers/owner-package-state.ts',
      'packages/workbench/src/workers/owner-child-admission.ts',
      'packages/workbench/src/workers/owner-shadow-assets.ts',
      'packages/workbench/src/workers/workbench-project-runtime.ts',
      'packages/workbench/src/workers/workbench-owner-controller.ts',
      'packages/workbench/src/workers/owner-child-node-executor.ts',
      'packages/workbench/src/workers/owner-child-bin-executor.ts',
      'packages/workbench/src/workers/owner-child-dev-server.ts',
      'packages/workbench/src/workers/node-entry-bootstrap.ts',
      'packages/workbench/src/workers/node-entry-runtime-preparation.ts',
    ]);
  });

  it('permits concrete-edge imports but rejects runtime literals and conditions', () => {
    expect(
      runtimeAdapterBoundaryViolations(
        'generic.ts',
        `import { prepareVite } from './vite-edge.ts';
prepareVite(input);
`,
      ),
    ).toEqual([]);
    expect(
      runtimeAdapterBoundaryViolations(
        'generic.ts',
        `if (isViteEntry(input)) activate('esbuild@0.28.0');`,
      ),
    ).toEqual([
      'generic.ts:1: consumer-specific identifier in a generic control-flow condition',
      'generic.ts:1: consumer-specific runtime literal "esbuild@0.28.0"',
    ]);
  });
});
