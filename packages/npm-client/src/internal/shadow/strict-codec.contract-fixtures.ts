import {
  type ShadowAssetPlan,
  attestBuiltinShadowSubstitution,
  planAppliedShadowSubstitutions,
} from './planner.ts';

export interface ShadowPlanCodecCase {
  readonly name: string;
  readonly value: () => unknown;
  /** Exact decode failure pinned at the unwrapped planner boundary. */
  readonly expected: RegExp;
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if ('value' in descriptor) freezeDeep(descriptor.value);
    }
    Object.freeze(value);
  }
  return value;
}

function substitution(installPath = 'node_modules/esbuild') {
  return attestBuiltinShadowSubstitution({
    trigger: { name: 'esbuild', requestedRange: '0.28.0', version: '0.28.0' },
    installPath,
    acquisition: { kind: 'synthetic' },
  });
}

export function validShadowPlan(): ShadowAssetPlan {
  return planAppliedShadowSubstitutions([substitution()]);
}

function frozen(value: unknown): unknown {
  return freezeDeep(structuredClone(value));
}

export const strictShadowPlanCodecCases: readonly ShadowPlanCodecCase[] = [
  {
    name: 'forged catalog id',
    expected: /applied shadow substitution catalog identity drifted/,
    value: () => {
      const plan = validShadowPlan();
      const applied = plan.substitutions[0]!;
      return frozen({
        ...plan,
        substitutions: [{ ...applied, catalog: { ...applied.catalog, id: 'forged-catalog' } }],
      });
    },
  },
  {
    name: 'forged catalog digest',
    expected: /applied shadow substitution catalog identity drifted/,
    value: () => {
      const plan = validShadowPlan();
      const applied = plan.substitutions[0]!;
      return frozen({
        ...plan,
        substitutions: [{ ...applied, catalog: { ...applied.catalog, digest: '0'.repeat(64) } }],
      });
    },
  },
  {
    name: 'forged substitution id',
    expected: /Not implemented: shadow-registry\.substitutionRecipe\.forged-substitution/,
    value: () => {
      const plan = validShadowPlan();
      return frozen({
        ...plan,
        substitutions: [{ ...plan.substitutions[0]!, substitutionId: 'forged-substitution' }],
      });
    },
  },
  {
    name: 'forged recipe digest',
    expected: /applied shadow substitution recipe digest drifted/,
    value: () => {
      const plan = validShadowPlan();
      return frozen({
        ...plan,
        substitutions: [{ ...plan.substitutions[0]!, recipeDigest: '0'.repeat(64) }],
      });
    },
  },
  {
    name: 'forged required-set digest',
    expected: /shadow asset plan is non-canonical or tampered/,
    value: () => frozen({ ...validShadowPlan(), requiredSetDigest: '0'.repeat(64) }),
  },
  {
    name: 'forged asset id',
    expected: /shadow asset plan is non-canonical or tampered/,
    value: () => {
      const plan = validShadowPlan();
      return frozen({
        ...plan,
        assets: [{ ...plan.assets[0]!, id: 'forged-asset' }],
      });
    },
  },
  {
    name: 'forged adapter id',
    expected: /applied shadow substitution is non-canonical or tampered/,
    value: () => {
      const plan = validShadowPlan();
      const applied = plan.substitutions[0]!;
      const binding = applied.binding!;
      return frozen({
        ...plan,
        substitutions: [
          { ...applied, binding: { ...binding, adapterId: 'rifty.runtime-adapter.absent.v1' } },
        ],
        bindings: [{ ...plan.bindings[0]!, adapterId: 'rifty.runtime-adapter.absent.v1' }],
      });
    },
  },
  {
    name: 'absent builtin substitution',
    expected: /shadow asset plan is non-canonical or tampered/,
    value: () => frozen({ ...validShadowPlan(), substitutions: [] }),
  },
  {
    name: 'tampered materialized byte count',
    expected: /applied shadow substitution is non-canonical or tampered/,
    value: () => {
      const plan = validShadowPlan();
      const applied = plan.substitutions[0]!;
      const file = applied.materialization.files[0]!;
      return frozen({
        ...plan,
        substitutions: [
          {
            ...applied,
            materialization: {
              ...applied.materialization,
              files: [
                { ...file, bytes: file.bytes + 1 },
                ...applied.materialization.files.slice(1),
              ],
            },
          },
        ],
      });
    },
  },
  {
    name: 'tampered asset member size',
    expected: /shadow asset plan is non-canonical or tampered/,
    value: () => {
      const plan = validShadowPlan();
      const asset = plan.assets[0]!;
      return frozen({ ...plan, assets: [{ ...asset, memberSize: asset.memberSize + 1 }] });
    },
  },
  {
    name: 'tampered asset member digest',
    expected: /shadow asset plan is non-canonical or tampered/,
    value: () => {
      const plan = validShadowPlan();
      return frozen({
        ...plan,
        assets: [{ ...plan.assets[0]!, memberSha256: '0'.repeat(64) }],
      });
    },
  },
  {
    name: 'noncanonical substitution ordering',
    expected: /shadow asset plan is non-canonical or tampered/,
    value: () => {
      const plan = planAppliedShadowSubstitutions([
        substitution(),
        substitution('node_modules/parent/node_modules/esbuild'),
      ]);
      return frozen({ ...plan, substitutions: [...plan.substitutions].reverse() });
    },
  },
  {
    name: 'duplicate asset member',
    expected: /shadow asset plan is non-canonical or tampered/,
    value: () => {
      const plan = validShadowPlan();
      return frozen({ ...plan, assets: [...plan.assets, structuredClone(plan.assets[0]!)] });
    },
  },
  {
    name: 'duplicate materialized file member',
    expected: /applied shadow substitution is non-canonical or tampered/,
    value: () => {
      const plan = validShadowPlan();
      const applied = plan.substitutions[0]!;
      return frozen({
        ...plan,
        substitutions: [
          {
            ...applied,
            materialization: {
              ...applied.materialization,
              files: [
                ...applied.materialization.files,
                structuredClone(applied.materialization.files[0]!),
              ],
            },
          },
        ],
      });
    },
  },
];
