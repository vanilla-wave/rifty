import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import schemaOneShadowLockfile from './fixtures/schema-1-shadow-lockfile.json';
import {
  attestBuiltinShadowSubstitution,
  createShadowSubstitutionLockfileTrace,
  decodeShadowSubstitutionPlan,
  materializeRegistryShadowSubstitutions,
  planAppliedShadowSubstitutions,
  planShadowSubstitutionsFromLockfile,
} from './planner.ts';

const SRI = `sha512-${btoa(String.fromCharCode(...new Uint8Array(64)))}`;
const RESOLVED = 'https://registry.invalid/esbuild-wasm-0.28.0.tgz';
type PlannedShadowSubstitutions = ReturnType<typeof planAppliedShadowSubstitutions>;
const planHasNoAssetField: 'assets' extends keyof PlannedShadowSubstitutions ? false : true = true;
void planHasNoAssetField;

function esbuildApplied(installPath = 'node_modules/esbuild') {
  return attestBuiltinShadowSubstitution({
    trigger: { name: 'esbuild', requestedRange: '^0.28.0', version: '0.28.0' },
    installPath,
    acquisition: {
      kind: 'registry',
      name: 'esbuild-wasm',
      version: '0.28.0',
      resolved: RESOLVED,
      integrity: SRI,
    },
  });
}

function esbuildLockfile(applied = esbuildApplied()) {
  const acquisitionPath = applied.materialization.installPath.replace(
    /node_modules\/esbuild$/u,
    'node_modules/esbuild-wasm',
  );
  const packages = {
    '': { version: '1.0.0' },
    [acquisitionPath]: {
      version: '0.28.0',
      resolved: RESOLVED,
      integrity: SRI,
    },
    [applied.materialization.installPath]: {
      version: '0.28.0',
      riftyShadowRecipe: applied.substitutionId,
    },
  };
  const plan = planAppliedShadowSubstitutions([applied]);
  return {
    plan,
    lockfile: {
      name: 'fixture',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages,
      rifty: { shadowSubstitutions: createShadowSubstitutionLockfileTrace(plan, { packages }) },
    },
  };
}

function schemaOneSingleEsbuildLockfile(): unknown {
  const lockfile = structuredClone(schemaOneShadowLockfile) as unknown as {
    packages: Record<string, unknown>;
    rifty: { shadowSubstitutions: { applied: Array<{ trigger: { name: string } }> } };
  };
  const root = lockfile.packages[''];
  const esbuild = lockfile.packages['node_modules/esbuild'];
  if (!root || !esbuild) throw new Error('schema-1 fixture is missing esbuild entries');
  lockfile.packages = {
    '': { version: '1.0.0', dependencies: { esbuild: '0.28.0' } },
    'node_modules/esbuild': esbuild,
  };
  lockfile.rifty.shadowSubstitutions.applied = lockfile.rifty.shadowSubstitutions.applied.filter(
    ({ trigger }) => trigger.name === 'esbuild',
  );
  return lockfile;
}

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return new Error('expected operation to reject');
}

describe('shadow substitution planner contract', () => {
  it('derives one package-path runtime binding from the attested registry acquisition', () => {
    const { plan, lockfile } = esbuildLockfile();
    expect(plan).toEqual({
      substitutions: [
        expect.objectContaining({ substitutionId: 'rifty.shadow-substitution.esbuild.v2' }),
      ],
      bindings: [
        {
          adapterId: 'rifty.runtime-adapter.esbuild.v1',
          packagePath: 'node_modules/esbuild-wasm',
        },
      ],
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(decodeShadowSubstitutionPlan(structuredClone(plan))).toEqual(plan);
    expect(planShadowSubstitutionsFromLockfile(structuredClone(lockfile))).toEqual(plan);
  });

  it('detaches ingress values and rejects trace/tree drift', () => {
    const input = {
      trigger: { name: 'esbuild', requestedRange: '^0.28.0', version: '0.28.0' },
      installPath: 'node_modules/esbuild',
      acquisition: {
        kind: 'registry' as const,
        name: 'esbuild-wasm',
        version: '0.28.0',
        resolved: RESOLVED,
        integrity: SRI,
      },
    };
    const applied = attestBuiltinShadowSubstitution(input);
    input.trigger.name = 'forged';
    expect(applied.trigger.name).toBe('esbuild');
    expect(Object.isFrozen(applied.materialization.files)).toBe(true);

    const { lockfile } = esbuildLockfile(applied);
    lockfile.packages['node_modules/esbuild-wasm']!.version = '0.27.0';
    expect(() => planShadowSubstitutionsFromLockfile(lockfile)).toThrow(/EBROKENLOCK/);
  });

  it('materializes a registry recipe without a runtime binding', async () => {
    const applied = attestBuiltinShadowSubstitution({
      trigger: { name: 'lightningcss', requestedRange: '^1.32.0', version: '1.32.0' },
      installPath: 'node_modules/lightningcss',
      acquisition: {
        kind: 'registry',
        name: 'lightningcss-wasm',
        version: '1.32.0',
        resolved: 'https://registry.invalid/lightningcss-wasm.tgz',
        integrity: SRI,
      },
    });
    const plan = planAppliedShadowSubstitutions([applied]);
    expect(plan.bindings).toEqual([]);

    const replay = decodeShadowSubstitutionPlan(structuredClone(plan));
    const fresh = new MemoryVfs();
    const restored = new MemoryVfs();
    await materializeRegistryShadowSubstitutions(fresh, '/project', plan, () => {});
    await materializeRegistryShadowSubstitutions(restored, '/project', replay, () => {});
    for (const file of applied.materialization.files) {
      const path = `/project/${applied.materialization.installPath}/${file.path}`;
      expect(await restored.readFile(path)).toEqual(await fresh.readFile(path));
    }
  });

  it('keeps an old lockfile without shadow identity on the canonical empty plan', () => {
    const oldLockfile = {
      name: 'ordinary-project',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { version: '1.0.0', dependencies: { picocolors: '1.1.1' } },
        'node_modules/picocolors': {
          version: '1.1.1',
          resolved: 'https://registry.invalid/picocolors-1.1.1.tgz',
        },
      },
    };
    const plan = planShadowSubstitutionsFromLockfile(oldLockfile);
    expect(plan).toEqual(planAppliedShadowSubstitutions([]));
    expect(plan).toEqual({ substitutions: [], bindings: [] });
    expect(Object.isFrozen(plan)).toBe(true);
  });

  it.each([
    ['one applied fact', schemaOneSingleEsbuildLockfile, 'esbuild'],
    [
      'reverse-ordered applied facts',
      () => structuredClone(schemaOneShadowLockfile),
      'lightningcss',
    ],
  ] as const)(
    'rejects a schema-1 trace with %s and names its canonical-first package',
    (_label, lockfile, packageName) => {
      expect(captureError(() => planShadowSubstitutionsFromLockfile(lockfile()))).toMatchObject({
        code: 'EBROKENLOCK',
        reason: 'shadow-trace-drift',
        packageName,
      });
    },
  );

  it('rejects nested accessors, sparse substitutions, and hidden extra fields', () => {
    let getterRan = false;
    const acquisition: Record<string, unknown> = {
      name: 'esbuild-wasm',
      version: '0.28.0',
      resolved: RESOLVED,
      integrity: SRI,
    };
    Object.defineProperty(acquisition, 'kind', {
      enumerable: true,
      get() {
        getterRan = true;
        return 'registry';
      },
    });
    expect(() =>
      attestBuiltinShadowSubstitution({
        trigger: { name: 'esbuild', requestedRange: '0.28.0', version: '0.28.0' },
        installPath: 'node_modules/esbuild',
        acquisition: acquisition as {
          kind: 'registry';
          name: string;
          version: string;
          resolved: string;
          integrity: string;
        },
      }),
    ).toThrow(/accessors/);
    expect(getterRan).toBe(false);

    expect(() =>
      planAppliedShadowSubstitutions(
        new Array(1) as ReturnType<typeof attestBuiltinShadowSubstitution>[],
      ),
    ).toThrow(/dense/);

    const plan = structuredClone(planAppliedShadowSubstitutions([esbuildApplied()]));
    Object.defineProperty(plan.substitutions[0]!.trigger, 'forged', { value: true });
    expect(() => decodeShadowSubstitutionPlan(plan)).toThrow(/extra or missing fields/);

    const compatibilityPlan = structuredClone(
      planAppliedShadowSubstitutions([esbuildApplied()]),
    ) as unknown as Record<string, unknown>;
    compatibilityPlan.assets = [];
    expect(() => decodeShadowSubstitutionPlan(compatibilityPlan)).toThrow(
      /extra or missing fields|assets/,
    );

    let planGetterRan = false;
    const accessorPlan = structuredClone(planAppliedShadowSubstitutions([esbuildApplied()]));
    Object.defineProperty(accessorPlan.bindings[0]!, 'packagePath', {
      enumerable: true,
      get() {
        planGetterRan = true;
        return 'node_modules/esbuild-wasm';
      },
    });
    expect(() => decodeShadowSubstitutionPlan(accessorPlan)).toThrow(/accessors|data property/);
    expect(planGetterRan).toBe(false);
  });

  it('requires a bijection between every marked root/nested entry and trace fact', () => {
    const root = esbuildApplied();
    const nested = esbuildApplied('node_modules/parent/node_modules/esbuild');
    const rootFixture = esbuildLockfile(root);
    const nestedFixture = esbuildLockfile(nested);
    const packages = {
      ...rootFixture.lockfile.packages,
      ...nestedFixture.lockfile.packages,
    };
    const lockfile = {
      lockfileVersion: 3,
      packages,
      rifty: {
        shadowSubstitutions: createShadowSubstitutionLockfileTrace(
          planAppliedShadowSubstitutions([root]),
          { packages },
        ),
      },
    };
    expect(() => planShadowSubstitutionsFromLockfile(lockfile)).toThrow(/no unique trace fact/);
  });
});
