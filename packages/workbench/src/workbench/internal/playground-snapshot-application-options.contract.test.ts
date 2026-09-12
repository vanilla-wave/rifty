import { describe, expect, it } from 'vitest';
import type { PlaygroundProjectPlan } from '../playground.ts';
import {
  definePlaygroundProject,
  inspectPlaygroundProjectDefinition,
  playgroundProjectDefinitionWire,
  recreatePlaygroundProjectDefinition,
} from './playground-project-definition.ts';

const context = Object.freeze({
  apiBaseUrl: 'https://host.test/',
  clientUrl: 'https://host.test/app/',
});
const snapshot = Object.freeze({
  snapshotId: `sha256:${'1'.repeat(64)}`,
  assetUrl: '/snapshot.tar.gz',
  templateId: 'snapshot-policy',
});

function plan(application?: unknown): PlaygroundProjectPlan {
  return {
    kind: 'node-cli' as const,
    id: 'scratch',
    starterId: 'snapshot-policy',
    templateId: 'snapshot-policy',
    entryPath: '/main.cjs',
    files: { '/main.cjs': 'console.log(42);' },
    firstMaterialization: {
      kind: 'snapshot' as const,
      snapshot,
      ...(application === undefined ? {} : { application }),
    },
  } as PlaygroundProjectPlan;
}

describe('snapshot application policy ownership and wire', () => {
  it.each([
    [undefined, { mode: 'initial-deployment-only' }],
    [{ mode: 'initial-deployment-only' }, { mode: 'initial-deployment-only' }],
    [{ mode: 'apply-snapshot' }, { mode: 'apply-snapshot', conflict: 'error' }],
    [
      { mode: 'apply-snapshot', conflict: 'error' },
      { mode: 'apply-snapshot', conflict: 'error' },
    ],
    [
      { mode: 'apply-snapshot', conflict: 'overwrite' },
      { mode: 'apply-snapshot', conflict: 'overwrite' },
    ],
  ])('owns and preserves policy %j without changing baseline identity', (input, expected) => {
    const baseline = inspectPlaygroundProjectDefinition(definePlaygroundProject(plan(), context));
    const definition = definePlaygroundProject(plan(input), context);
    const inspected = inspectPlaygroundProjectDefinition(definition);
    expect(inspected.firstMaterialization).toMatchObject({ application: expected });
    expect(inspected.identity).toBe(baseline.identity);
    expect(inspected.baselineFingerprint).toBe(baseline.baselineFingerprint);
    const wire = playgroundProjectDefinitionWire(definition);
    const recreated = inspectPlaygroundProjectDefinition(
      recreatePlaygroundProjectDefinition(structuredClone(wire), context),
    );
    expect(recreated.firstMaterialization).toEqual(inspected.firstMaterialization);
    expect(recreated.identity).toBe(inspected.identity);
  });

  it.each([
    null,
    [],
    'apply-snapshot',
    {},
    { mode: 'unknown' },
    { mode: 'initial-deployment-only', conflict: 'overwrite' },
    { mode: 'apply-snapshot', conflict: 'unknown' },
    { mode: 'apply-snapshot', conflict: null },
    { mode: 'apply-snapshot', extra: true },
  ])('rejects malformed policy %j at definition ownership', (application) => {
    expect(() => definePlaygroundProject(plan(application), context)).toThrow(TypeError);
  });

  it('rejects accessors before reading policy data', () => {
    let calls = 0;
    const application = Object.defineProperty({}, 'mode', {
      enumerable: true,
      get() {
        calls++;
        return 'apply-snapshot';
      },
    });
    expect(() => definePlaygroundProject(plan(application), context)).toThrow(TypeError);
    expect(calls).toBe(0);
  });
});
