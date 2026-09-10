import type { WorkbenchHealth, WorkbenchProjectOpenProgress } from '@riftydev/workbench';
import { withSlowProgress } from './slow-progress.ts';

/** One transition owns both the delayed preparing label and its actual drain counts. */
export async function withProjectOpenProgress<T>(
  work: Promise<T>,
  options: {
    readonly health: WorkbenchHealth;
    readonly label: string | undefined;
    readonly setLabel: (label: string | undefined) => void;
    readonly setPersistence: (progress: WorkbenchProjectOpenProgress['persistence']) => void;
  },
): Promise<T> {
  const unsubscribe = options.health.subscribe((snapshot) => {
    const progress = snapshot.projectOpen?.persistence;
    options.setPersistence(progress);
    if (progress !== undefined) options.setLabel(options.label);
  });
  try {
    return await (options.label === undefined
      ? work
      : withSlowProgress(work, {
          delayMs: 250,
          onSlow: () => options.setLabel(options.label),
        }));
  } finally {
    unsubscribe();
    options.setPersistence(undefined);
    options.setLabel(undefined);
  }
}
