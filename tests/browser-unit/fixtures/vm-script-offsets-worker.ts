/// <reference lib="webworker" />
/**
 * Runs one `vm` parity case's code in a fresh Chromium module-worker realm
 * against rifty's real `node:vm` module (unit
 * runtime-js/vm-run-in-this-context-offsets). Chromium has no embedder
 * PrepareStackTraceCallback and starts with `Error.prepareStackTrace`
 * undefined, so default stack rendering here is V8's own — the path the
 * Node-host parity runner cannot reach.
 */
import * as vm from '../../../packages/runtime-js/src/builtins/vm/index.ts';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

scope.addEventListener('message', async (event: MessageEvent<{ readonly code: string }>) => {
  const baseline = {
    type: typeof Error.prepareStackTrace,
    own: Object.hasOwn(Error, 'prepareStackTrace'),
  };
  const lines: string[] = [];
  const caseConsole = {
    log: (...args: unknown[]) => lines.push(args.map((arg) => String(arg)).join(' ')),
  };
  const caseRequire = (id: string): unknown => {
    if (id === 'node:vm') return vm;
    throw new Error(`vm-script-offsets worker: unexpected require('${id}')`);
  };
  try {
    new Function('require', 'console', event.data.code)(caseRequire, caseConsole);
    // Cases print deferred rows from one timer / promise turn.
    await nextMacrotask();
    await nextMacrotask();
    scope.postMessage({ ok: true, baseline, stdout: lines.join('\n') });
  } catch (error) {
    scope.postMessage({
      ok: false,
      baseline,
      stdout: lines.join('\n'),
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
});
