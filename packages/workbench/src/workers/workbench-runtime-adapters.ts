import { getProcessCwd } from '@riftydev/runtime-js/builtins/process';
import { ref, unref } from '@riftydev/runtime-js/internal';
import { activatePackageRuntimeAdapters } from '@riftydev/shadow-registry/runtime';

export type { PackageRuntimeBinding as WorkbenchRuntimeBinding } from '@riftydev/shadow-registry/runtime';

/** Reusable realm: adapters follow the live Node cwd and existing event-loop refs (ADR-0421). */
export function workbenchRuntimeAdapterOwnership(): {
  readonly getCwd: () => string;
  readonly refs: { ref(): void; unref(): void };
} {
  return { getCwd: getProcessCwd, refs: { ref, unref } };
}

export function activateWorkbenchRuntimeAdapters(
  options: Pick<Parameters<typeof activatePackageRuntimeAdapters>[0], 'bindings' | 'fs' | 'cwd'>,
): Promise<void> {
  return activatePackageRuntimeAdapters({ ...options, ...workbenchRuntimeAdapterOwnership() });
}
