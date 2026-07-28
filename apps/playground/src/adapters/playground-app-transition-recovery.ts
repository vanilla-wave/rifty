import type { PlaygroundAppProjectContext } from './playground-app-runtime.ts';

export async function rebindAfterPlaygroundTransitionFailure(
  trigger: unknown,
  restored: PlaygroundAppProjectContext | null,
  bind: (context: PlaygroundAppProjectContext) => Promise<unknown>,
): Promise<never> {
  if (restored !== null) await bind(restored);
  throw trigger;
}
