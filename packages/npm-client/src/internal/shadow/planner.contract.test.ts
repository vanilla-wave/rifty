import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import {
  attestBuiltinShadowSubstitution,
  createShadowSubstitutionLockfileTrace,
  decodeShadowAssetPlan,
  materializeRegistryShadowSubstitutions,
  planAppliedShadowSubstitutions,
  planShadowSubstitutionsFromLockfile,
} from './planner.ts';
import { strictShadowPlanCodecCases } from './strict-codec.contract-fixtures.ts';

describe('shadow substitution planner contract', () => {
  it.each(strictShadowPlanCodecCases)('strict-decodes $name at planner ingress', ({ value }) => {
    expect(() => decodeShadowAssetPlan(value())).toThrow();
  });

  it('replays exact synthetic esbuild identity and binding', () => {
    const applied = attestBuiltinShadowSubstitution({
      trigger: { name: 'esbuild', requestedRange: '^0.28.0', version: '0.28.0' },
      installPath: 'node_modules/esbuild',
      acquisition: { kind: 'synthetic' },
    });
    const plan = planAppliedShadowSubstitutions([applied]);
    expect(plan.bindings).toEqual([
      {
        adapterId: 'rifty.runtime-adapter.esbuild.v1',
        assets: ['esbuild-wasm@0.28.0/package/esbuild.wasm'],
      },
    ]);

    const lockfile = {
      name: 'fixture',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { version: '1.0.0' },
        'node_modules/esbuild': {
          version: '0.28.0',
          resolved: `rifty:shadow-substitution/${applied.substitutionId}@${applied.recipeDigest}`,
          riftyShadowRecipe: applied.substitutionId,
        },
      },
      rifty: { shadowSubstitutions: createShadowSubstitutionLockfileTrace(plan) },
    };
    const replay = planShadowSubstitutionsFromLockfile(structuredClone(lockfile));
    expect(replay).toEqual(plan);
  });

  it('detaches ingress values and rejects trace/tree drift', () => {
    const input = {
      trigger: { name: 'esbuild', requestedRange: '^0.28.0', version: '0.28.0' },
      installPath: 'node_modules/esbuild',
      acquisition: { kind: 'synthetic' as const },
    };
    const applied = attestBuiltinShadowSubstitution(input);
    input.trigger.name = 'forged';
    expect(applied.trigger.name).toBe('esbuild');
    expect(Object.isFrozen(applied.materialization.files)).toBe(true);

    const plan = planAppliedShadowSubstitutions([applied]);
    const lockfile = {
      name: 'fixture',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { version: '1.0.0' },
        'node_modules/esbuild': {
          version: '0.27.0',
          resolved: `rifty:shadow-substitution/${applied.substitutionId}@${applied.recipeDigest}`,
          riftyShadowRecipe: applied.substitutionId,
        },
      },
      rifty: { shadowSubstitutions: createShadowSubstitutionLockfileTrace(plan) },
    };
    expect(() => planShadowSubstitutionsFromLockfile(lockfile)).toThrow(/EBROKENLOCK/);
  });

  it('materializes a registry recipe without adding runtime assets', async () => {
    const applied = attestBuiltinShadowSubstitution({
      trigger: { name: 'lightningcss', requestedRange: '^1.32.0', version: '1.32.0' },
      installPath: 'node_modules/lightningcss',
      acquisition: {
        kind: 'registry',
        name: 'lightningcss-wasm',
        version: '1.32.0',
        resolved: 'https://registry.invalid/lightningcss-wasm.tgz',
        integrity: `sha512-${btoa(String.fromCharCode(...new Uint8Array(64)))}`,
      },
    });
    const plan = planAppliedShadowSubstitutions([applied]);
    expect(plan.assets).toEqual([]);
    expect(plan.bindings).toEqual([]);

    const replay = decodeShadowAssetPlan(structuredClone(plan));
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
    expect(Object.isFrozen(plan)).toBe(true);
    expect(plan.substitutions).toEqual([]);
  });

  it('rejects nested accessors without invoking them', () => {
    let getterRan = false;
    const acquisition = {};
    Object.defineProperty(acquisition, 'kind', {
      enumerable: true,
      get() {
        getterRan = true;
        return 'synthetic';
      },
    });
    expect(() =>
      attestBuiltinShadowSubstitution({
        trigger: { name: 'esbuild', requestedRange: '0.28.0', version: '0.28.0' },
        installPath: 'node_modules/esbuild',
        acquisition: acquisition as { kind: 'synthetic' },
      }),
    ).toThrow(/accessors/);

    const applied = attestBuiltinShadowSubstitution({
      trigger: { name: 'esbuild', requestedRange: '0.28.0', version: '0.28.0' },
      installPath: 'node_modules/esbuild',
      acquisition: { kind: 'synthetic' },
    });
    const forged = structuredClone(planAppliedShadowSubstitutions([applied]));
    Object.defineProperty(forged.substitutions[0]!.materialization.files[0]!, 'path', {
      enumerable: true,
      get() {
        getterRan = true;
        return 'package.json';
      },
    });
    expect(() => decodeShadowAssetPlan(forged)).toThrow(/accessors/);
    expect(getterRan).toBe(false);

    expect(() =>
      planAppliedShadowSubstitutions(
        new Array(1) as ReturnType<typeof attestBuiltinShadowSubstitution>[],
      ),
    ).toThrow(/dense/);
  });

  it.each(['attestation', 'nested-acquisition', 'hidden-required', 'decoded-plan'] as const)(
    'rejects non-enumerable extra fields at the %s ingress',
    (boundary) => {
      const input = {
        trigger: { name: 'esbuild', requestedRange: '0.28.0', version: '0.28.0' },
        installPath: 'node_modules/esbuild',
        acquisition: { kind: 'synthetic' as const },
      };
      if (boundary === 'attestation') {
        Object.defineProperty(input, 'forged', { value: true });
        expect(() => attestBuiltinShadowSubstitution(input)).toThrow(/extra or missing fields/);
        return;
      }
      if (boundary === 'nested-acquisition') {
        Object.defineProperty(input.acquisition, 'forged', { value: true });
        expect(() => attestBuiltinShadowSubstitution(input)).toThrow(/extra or missing fields/);
        return;
      }
      if (boundary === 'hidden-required') {
        Object.defineProperty(input, 'installPath', {
          value: input.installPath,
          enumerable: false,
        });
        expect(() => attestBuiltinShadowSubstitution(input)).toThrow(/non-enumerable fields/);
        return;
      }

      const applied = attestBuiltinShadowSubstitution(input);
      const plan = structuredClone(planAppliedShadowSubstitutions([applied]));
      Object.defineProperty(plan.substitutions[0]!.trigger, 'forged', { value: true });
      expect(() => decodeShadowAssetPlan(plan)).toThrow(/extra or missing fields/);
    },
  );

  it('requires a bijection between every marked root/nested entry and trace fact', () => {
    const root = attestBuiltinShadowSubstitution({
      trigger: { name: 'esbuild', requestedRange: '0.28.0', version: '0.28.0' },
      installPath: 'node_modules/esbuild',
      acquisition: { kind: 'synthetic' },
    });
    const nested = attestBuiltinShadowSubstitution({
      trigger: { name: 'esbuild', requestedRange: '0.28.0', version: '0.28.0' },
      installPath: 'node_modules/parent/node_modules/esbuild',
      acquisition: { kind: 'synthetic' },
    });
    const lockfile = {
      lockfileVersion: 3,
      packages: {
        'node_modules/esbuild': {
          version: '0.28.0',
          resolved: `rifty:shadow-substitution/${root.substitutionId}@${root.recipeDigest}`,
          riftyShadowRecipe: root.substitutionId,
        },
        'node_modules/parent/node_modules/esbuild': {
          version: '0.28.0',
          resolved: `rifty:shadow-substitution/${nested.substitutionId}@${nested.recipeDigest}`,
          riftyShadowRecipe: nested.substitutionId,
        },
      },
      rifty: {
        shadowSubstitutions: createShadowSubstitutionLockfileTrace(
          planAppliedShadowSubstitutions([root]),
        ),
      },
    };
    expect(() => planShadowSubstitutionsFromLockfile(lockfile)).toThrow(/no unique trace fact/);
  });
});
