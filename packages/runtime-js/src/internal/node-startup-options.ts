import { NotImplementedError } from '@riftydev/io';
import { readNodeEntryBootstrapIfPresent } from '../builtins/node-entry-runtime-config.ts';

export interface NodeStartupOptions {
  readonly execArgv: readonly string[];
  readonly preloads: readonly string[];
  readonly conditions: readonly string[];
  readonly resolveParentURL: boolean;
}

const empty: NodeStartupOptions = Object.freeze({
  execArgv: Object.freeze([]),
  preloads: Object.freeze([]),
  conditions: Object.freeze([]),
  resolveParentURL: false,
});

type Surface = 'worker-thread' | 'fork';
function unsupported(surface: Surface, detail: string): never {
  throw new NotImplementedError(
    surface === 'worker-thread' ? 'worker_threads.Worker.execArgv' : 'child_process.fork.execArgv',
    detail,
  );
}

/** Compile the supported startup family, keeping the exact ordered argv separate. */
export function compileNodeStartupOptions(value: unknown, surface: Surface): NodeStartupOptions {
  if (!Array.isArray(value))
    unsupported(surface, 'non-array startup arguments are not implemented');
  const execArgv = value.map((arg: unknown) => {
    if (typeof arg !== 'string')
      unsupported(surface, 'non-string startup arguments are not implemented');
    return arg;
  });
  const preloads: string[] = [];
  const conditions: string[] = [];
  let resolveParentURL = false;
  for (let index = 0; index < execArgv.length; index++) {
    const flag = execArgv[index];
    if (flag === '--experimental-import-meta-resolve') {
      resolveParentURL = true;
      continue;
    }
    if (flag === '--require' || flag === '--conditions') {
      const operand = execArgv[++index];
      if (operand === undefined || operand.startsWith('-')) {
        if (surface === 'fork')
          unsupported(surface, `incomplete ${flag} startup context is not implemented`);
        throw Object.assign(
          new Error(`Initiated Worker with invalid execArgv flags: ${flag} requires an argument`),
          { code: 'ERR_WORKER_INVALID_EXEC_ARGV' },
        );
      }
      (flag === '--require' ? preloads : conditions).push(operand);
    } else unsupported(surface, `startup option ${String(flag)} is not implemented`);
  }
  return Object.freeze({
    execArgv: Object.freeze(execArgv),
    preloads: Object.freeze(preloads),
    conditions: Object.freeze(conditions),
    resolveParentURL,
  });
}

/** Public process.execArgv is never the loader policy or Worker inheritance source. */
export function readNodeStartupOptions(): NodeStartupOptions {
  const launch = readNodeEntryBootstrapIfPresent()?.launch;
  if (launch === undefined || launch.kind === 'eval') return empty;
  return compileNodeStartupOptions(
    launch.execArgv,
    launch.kind === 'worker-thread' ? 'worker-thread' : 'fork',
  );
}
