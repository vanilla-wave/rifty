export async function rethrowAfterCleanup(
  scope: string,
  trigger: unknown,
  cleanup: () => Promise<void>,
): Promise<never> {
  try {
    await cleanup();
  } catch (cleanupFailure) {
    throw new AggregateError([trigger, cleanupFailure], `${scope} failed and cleanup failed`);
  }
  throw trigger;
}
