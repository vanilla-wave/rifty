import { getProcessCwd } from '@riftydev/runtime-js/builtins/process';
import { ref, unref } from '@riftydev/runtime-js/internal';
import { activatePackageRuntimeAdapters } from '@riftydev/shadow-registry/runtime';

export type { PackageRuntimeBinding as WorkbenchRuntimeBinding } from '@riftydev/shadow-registry/runtime';

/** The reusable no-COI realm supplies its live Node cwd and existing event-loop refs. */
export function activateWorkbenchRuntimeAdapters(
  options: Pick<Parameters<typeof activatePackageRuntimeAdapters>[0], 'bindings' | 'fs' | 'cwd'>,
): Promise<void> {
  return activatePackageRuntimeAdapters({
    ...options,
    getCwd: getProcessCwd,
    refs: { ref, unref },
  });
}
