import { NotImplementedError } from '@riftydev/io';
import {
  type ShadowRuntimeTier,
  builtinRecipeById,
  canReprojectShadowRecipe,
} from '@riftydev/shadow-registry/internal';
import { type Lockfile, recordShadowSubstitutionPlan } from '../../linker.ts';
import { builtinRecipeForRequest, registryRecipeForResolution } from './admission.ts';
import {
  attestBuiltinShadowSubstitution,
  planAppliedShadowSubstitutions,
  planShadowSubstitutionsFromLockfile,
  registryAcquisitionInstallPath,
} from './planner.ts';
import { assertRegistryShadowProjection } from './substitution.ts';

/** Select another host policy over verified current-catalog acquisition facts. */
export function reprojectShadowLockfile(lockfile: Lockfile, runtimeTier: ShadowRuntimeTier) {
  const prior = planShadowSubstitutionsFromLockfile(lockfile);
  const replacements: Array<{
    readonly installPath: string;
    readonly files: ReadonlyArray<{ readonly path: string; readonly content: string }>;
  }> = [];
  const facts = prior.substitutions.map((fact) => {
    const from = builtinRecipeById(fact.substitutionId, fact.trigger.version);
    if (from?.runtimeTier === undefined || from.runtimeTier === runtimeTier) return fact;
    if (fact.acquisition.kind !== 'registry')
      throw new NotImplementedError('shadow-registry.runtime-tier.source');
    const recipe = registryRecipeForResolution(
      builtinRecipeForRequest(
        fact.trigger.name,
        fact.trigger.requestedRange,
        undefined,
        undefined,
        fact.acquisition.version,
        runtimeTier,
      ),
      fact.acquisition.name,
      fact.acquisition.version,
    );
    if (!recipe || !canReprojectShadowRecipe(from, recipe))
      throw new NotImplementedError(
        'shadow-registry.runtime-tier.source',
        'tier changes must retain the same source and bin placement',
      );
    const entry = lockfile.packages[registryAcquisitionInstallPath(fact)];
    if (!entry) throw new TypeError('attested acquisition entry is missing');
    assertRegistryShadowProjection(recipe, entry);
    replacements.push({
      installPath: fact.materialization.installPath,
      files: recipe.materialization.files,
    });
    return attestBuiltinShadowSubstitution({
      substitutionId: recipe.id,
      trigger: fact.trigger,
      installPath: fact.materialization.installPath,
      acquisition: fact.acquisition,
    });
  });
  if (replacements.length === 0) return { lockfile, replacements };
  const plan = planAppliedShadowSubstitutions(facts);
  const projected = recordShadowSubstitutionPlan(structuredClone(lockfile), plan);
  // The ordinary strict reader remains the authority for the derived receipt.
  planShadowSubstitutionsFromLockfile(projected);
  return { lockfile: projected, replacements };
}
