import type { ProjectAcquisitionPlan } from '../project-materialization.ts';
import { projectRelativePath, projectRuntimeShellWord } from './node-command.ts';

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
