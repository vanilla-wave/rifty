const signalExitCode = Object.freeze({ SIGINT: 130, SIGTERM: 143 });

export function createResourceCleanup(options) {
  const entries = [];
  let cleanupPromise;
  let signalPromise;

  function register(cleanup) {
    if (typeof cleanup !== 'function') throw new TypeError('Resource cleanup must be a function');
    if (cleanupPromise !== undefined) {
      throw new Error('Cannot register a resource after cleanup started');
    }
    let active = true;
    const entry = {
      async cleanup() {
        if (!active) return;
        active = false;
        await cleanup();
      },
      disarm() {
        active = false;
      },
    };
    entries.push(entry);
    return Object.freeze(entry);
  }

  function cleanup() {
    cleanupPromise ??= (async () => {
      const errors = [];
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        try {
          await entries[index].cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'Packed consumer cleanup failed');
    })();
    return cleanupPromise;
  }

  function handleSignal(signal) {
    const exitCode = signalExitCode[signal];
    if (exitCode === undefined) throw new TypeError(`Unsupported terminating signal: ${signal}`);
    signalPromise ??= (async () => {
      try {
        await cleanup();
      } catch (error) {
        options.reportError(error);
      }
      options.exit(exitCode);
    })();
    return signalPromise;
  }

  function installSignalHandlers(target) {
    const onInterrupt = () => {
      void handleSignal('SIGINT');
    };
    const onTerminate = () => {
      void handleSignal('SIGTERM');
    };
    target.once('SIGINT', onInterrupt);
    target.once('SIGTERM', onTerminate);
    return () => {
      target.off('SIGINT', onInterrupt);
      target.off('SIGTERM', onTerminate);
    };
  }

  return Object.freeze({ register, cleanup, handleSignal, installSignalHandlers });
}
