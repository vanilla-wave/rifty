/**
 * Dev-boot cleanup-trigger predicate (ADR-0165 §5), extracted from the owner's
 * inline boot closure so the multi-project rule is unit-testable outside a
 * worker realm (mirrors project-deps.ts extraction).
 *
 * The owner is ONE persistent realm: a switch accumulates the prior project's
 * node_modules/lockfile/package.json, which trips a new template's lockfile
 * coverage (EBROKENLOCK). The pre-multi-project guard fired only on a TEMPLATE
 * change — but two projects from the SAME starter share templateId yet must not
 * share node_modules. So clean fires on a template change OR a root change. The
 * first boot (`lastTemplateId === null`) never cleans: there is no prior dev
 * run, and the from-scratch dependency-arrival path owns the first clean.
 */
export interface DevBootCleanInput {
  readonly lastTemplateId: string | null;
  readonly lastRoot: string | null;
  readonly nextTemplateId: string;
  readonly nextRoot: string;
}

export function shouldCleanForDevBoot(input: DevBootCleanInput): boolean {
  if (input.lastTemplateId === null) return false;
  return input.nextTemplateId !== input.lastTemplateId || input.nextRoot !== input.lastRoot;
}

export interface DevBootCleanWithInstallStateInput extends DevBootCleanInput {
  readonly fromScratch: boolean;
  readonly installStampSatisfied: boolean;
}

export function shouldCleanForDevBootWithInstallState(
  input: DevBootCleanWithInstallStateInput,
): boolean {
  if (!shouldCleanForDevBoot(input)) return false;
  if (input.fromScratch && input.installStampSatisfied) return false;
  return true;
}
