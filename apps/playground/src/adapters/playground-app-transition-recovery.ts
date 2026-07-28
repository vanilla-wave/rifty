import { rethrowAfterCleanup } from './cleanup-after-failure.ts';
import type { PlaygroundAppProjectContext } from './playground-app-runtime.ts';

export async function rebindAfterPlaygroundTransitionFailure(
  trigger: unknown,
  restored: PlaygroundAppProjectContext | null,
  bind: (context: PlaygroundAppProjectContext) => Promise<unknown>,
): Promise<never> {
  return rethrowAfterCleanup('Playground App project rebinding', trigger, async () => {
    if (restored !== null) await bind(restored);
  });
}
