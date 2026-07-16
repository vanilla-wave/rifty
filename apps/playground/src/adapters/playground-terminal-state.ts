import type { TerminalState } from '@riftydev/terminal/state';
import { assertProjectPath } from '../workbench/project-file-boundary.ts';
import type { ProjectTerminalSnapshot } from '../workbench/project-terminal.ts';

export type PersistedTerminalStateSource = 'legacy-absolute' | 'project-rooted';

export interface PersistedProjectTerminalStateInput {
  readonly source: PersistedTerminalStateSource;
  readonly state: TerminalState;
  readonly legacyWorkspacePrefix?: string;
}

function safeProjectCwd(cwd: string): string {
  try {
    return assertProjectPath(cwd, { allowRoot: true });
  } catch {
    return '/';
  }
}

/** Host-only migration; owner validation remains authoritative for reachability. */
export function persistedProjectTerminalState(
  input: PersistedProjectTerminalStateInput,
): ProjectTerminalSnapshot {
  let cwd = '/';
  if (input.source === 'project-rooted') {
    cwd = safeProjectCwd(input.state.cwd);
  } else {
    const prefix = input.legacyWorkspacePrefix;
    if (prefix !== undefined) {
      if (input.state.cwd === prefix) {
        cwd = '/';
      } else if (input.state.cwd.startsWith(`${prefix}/`)) {
        cwd = safeProjectCwd(input.state.cwd.slice(prefix.length));
      }
    }
  }
  return Object.freeze({ cwd, env: Object.freeze({ ...input.state.env }) });
}
