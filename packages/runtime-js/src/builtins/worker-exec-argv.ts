import { NotImplementedError } from '@riftydev/io';

/**
 * Explicit Worker/fork `execArgv` vitest 4.1.11 always passes. Inherited eval
 * identity stays a loud ceiling (`worker-threads-inherited-exec-argv`).
 * `--experimental-import-meta-resolve` is already the Node 24 default here.
 * `--require` is preloaded by `runNodeEntry`. `--conditions` joins resolution.
 */
export function assertSupportedWorkerExecArgv(argv: readonly string[]): void {
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (typeof flag !== 'string') {
      throw unsupported('execArgv entries must be strings');
    }
    if (flag === '--experimental-import-meta-resolve') continue;
    if (flag === '--require' || flag === '--conditions') {
      const value = argv[index + 1];
      if (typeof value !== 'string' || value.startsWith('-'))
        throw unsupported(`${flag} needs a value`);
      index += 1;
      continue;
    }
    throw unsupported('node-entry v3 cannot preserve worker-thread execArgv identity');
  }
}

function unsupported(detail: string): NotImplementedError {
  return new NotImplementedError('worker_threads.Worker.execArgv', detail);
}
