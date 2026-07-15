import { NotImplementedError } from '@riftydev/io';
import type { PreviewHandle, PreviewReadiness } from './preview-readiness.ts';
import type { ProjectRuntime } from './project-session.ts';
import { type ProjectTerminal, projectTerminalAdmission } from './project-terminal.ts';

export interface ViteProjectRuntimeDependencies {
  readonly terminal: ProjectTerminal;
  readonly ownerToken: string;
  readonly createPreviewReadiness: () => PreviewReadiness;
}

/** Internal Vite runtime; Contract+RED until the owner-correlated composition lands. */
export function createViteProjectRuntime(
  dependencies: ViteProjectRuntimeDependencies,
): ProjectRuntime<PreviewHandle> {
  void dependencies;
  void projectTerminalAdmission;
  const gap = (): NotImplementedError => new NotImplementedError('workbench.vite-project-runtime');
  return Object.freeze({
    start() {
      throw gap();
    },
    close(): Promise<void> {
      return Promise.reject(gap());
    },
  });
}
