import type { BootResult } from '../boot.ts';
import type { TerminalPersistence } from '../glue/terminal-persistence.ts';
import { rethrowAfterCleanup } from './cleanup-after-failure.ts';
import type { AppProps } from './playground-app.tsx';
import type { PlaygroundAppWorkbenchOpenOutcome } from './playground-workbench-host.ts';

export interface PlaygroundPageEntryDependencies {
  readonly bootstrapPlayground: () => Promise<BootResult>;
  readonly openPlaygroundAppWorkbench: () => Promise<PlaygroundAppWorkbenchOpenOutcome>;
  readonly createTerminalPersistence: () => Promise<TerminalPersistence>;
  readonly mountOccupied: () => void;
  readonly mountApp: (props: AppProps) => void;
}

/** Finite composition transaction; successful App mount consumes the Workbench. */
export async function mountPlaygroundPage(
  dependencies: PlaygroundPageEntryDependencies,
): Promise<void> {
  const boot = await dependencies.bootstrapPlayground();
  const outcome = await dependencies.openPlaygroundAppWorkbench();
  if (outcome.status === 'occupied') {
    dependencies.mountOccupied();
    return;
  }

  try {
    const terminalPersistence = await dependencies.createTerminalPersistence();
    dependencies.mountApp({
      boot,
      terminalPersistence,
      workbench: outcome.workbench,
    });
  } catch (error) {
    return rethrowAfterCleanup('Playground page entry', error, () => outcome.workbench.close());
  }
}
