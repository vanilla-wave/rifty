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
  readonly mountFatal: (error: unknown) => void;
}

async function composePlaygroundPage(dependencies: PlaygroundPageEntryDependencies): Promise<void> {
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
    return await rethrowAfterCleanup('Playground page entry', error, () =>
      outcome.workbench.close(),
    );
  }
}

/**
 * Finite composition transaction; successful App mount consumes the Workbench.
 * Every other outcome is painted by this coordinator: occupied notice, or the
 * standalone failure notice — a fatal never leaves the cold-boot skeleton up.
 * The original failure (with any cleanup failure aggregated) still propagates.
 */
export async function mountPlaygroundPage(
  dependencies: PlaygroundPageEntryDependencies,
): Promise<void> {
  try {
    await composePlaygroundPage(dependencies);
  } catch (error) {
    return rethrowAfterCleanup('Playground page entry failure notice', error, async () =>
      dependencies.mountFatal(error),
    );
  }
}
