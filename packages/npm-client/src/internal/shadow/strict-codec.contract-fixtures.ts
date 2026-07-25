import {
  type ShadowAssetPlan,
  attestBuiltinShadowSubstitution,
  planAppliedShadowSubstitutions,
} from './planner.ts';

export interface ShadowPlanCodecCase {
  readonly name: string;
  readonly value: () => unknown;
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
    value: () => frozen({ ...validShadowPlan(), requiredSetDigest: '0'.repeat(64) }),
  },
  {
    name: 'forged asset id',
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
    value: () => frozen({ ...validShadowPlan(), substitutions: [] }),
  },
  {
    name: 'tampered materialized byte count',
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
    value: () => {
      const plan = validShadowPlan();
      const asset = plan.assets[0]!;
      return frozen({ ...plan, assets: [{ ...asset, memberSize: asset.memberSize + 1 }] });
    },
  },
  {
    name: 'tampered asset member digest',
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
    value: () => {
      const plan = validShadowPlan();
      return frozen({ ...plan, assets: [...plan.assets, structuredClone(plan.assets[0]!)] });
    },
  },
  {
    name: 'duplicate materialized file member',
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
