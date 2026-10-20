export {
  attestBuiltinShadowSubstitution,
  planAppliedShadowSubstitutions,
  planShadowSubstitutionsFromLockfile,
  registryAcquisitionInstallPath,
  registryShadowEmbeddedSourcesFromLockfile,
  type ShadowSubstitutionPlan,
} from './planner.ts';
export {
  companionInstallPathsForInstallResult,
  shadowSubstitutionPlanForInstallResult,
} from './install-result.ts';
export { reprojectShadowLockfile } from './runtime-tier.ts';
