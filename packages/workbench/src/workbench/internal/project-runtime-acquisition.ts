import type { ProjectAcquisitionPlan } from '../project-materialization.ts';
import { projectRelativePath, projectRuntimeShellWord } from './node-command.ts';

export interface ProjectRuntimeAcquisitionEvidence {
  readonly sid: string;
  readonly rid: string;
}

/** Read-only command policy shared by every runtime start in one project. */
export interface ProjectRuntimeAcquisition {
  line(runtimeLine: string, cwd: string): string;
}

export interface ProjectRuntimeAcquisitionController {
  readonly runtime: ProjectRuntimeAcquisition;
  acceptFirstMaterializationConsumed(evidence: ProjectRuntimeAcquisitionEvidence): void;
}

function shellWord(value: string): string {
  if (value.includes('\0')) throw new TypeError('Runtime status text must not contain NUL');
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function projectRuntimeShellLine(
  runtimeLine: string,
  acquisition: ProjectAcquisitionPlan | undefined,
  cwd = '/',
): string {
  if (acquisition?.kind !== 'install') return runtimeLine;
  const notices = acquisition.snapshotFailures.map(
    (failure) => `echo ${shellWord(`${failure.snapshotId}: ${failure.reason}`)}`,
  );
  const root = projectRelativePath('/', cwd);
  const install =
    root === '.' ? 'npm install' : `npm --prefix ${projectRuntimeShellWord(root)} install`;
  return [...notices, install, runtimeLine].join(' && ');
}

/** One project-scoped, monotonic projection of owner consumption evidence. */
export function createProjectRuntimeAcquisitionController(
  acquisition: ProjectAcquisitionPlan | undefined,
): ProjectRuntimeAcquisitionController {
  let consumedBy: ProjectRuntimeAcquisitionEvidence | null = null;
  const runtime = Object.freeze({
    line(runtimeLine: string, cwd: string): string {
      return projectRuntimeShellLine(
        runtimeLine,
        acquisition?.kind === 'install' && consumedBy === null ? acquisition : undefined,
        cwd,
      );
    },
  });
  return Object.freeze({
    runtime,
    acceptFirstMaterializationConsumed(evidence: ProjectRuntimeAcquisitionEvidence): void {
      if (acquisition?.kind !== 'install') {
        throw new Error(
          'Owner consumed first materialization for a project without an install plan',
        );
      }
      if (consumedBy !== null) {
        throw new Error(
          `Owner repeated first-materialization evidence after ${consumedBy.sid}/${consumedBy.rid}`,
        );
      }
      consumedBy = Object.freeze({ sid: evidence.sid, rid: evidence.rid });
    },
  });
}
