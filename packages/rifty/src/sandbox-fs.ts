import type { RuntimeFs } from '@riftydev/runtime-js';

/** Keep captured public FS handles live across the sandbox owner's replacement. */
export function delegateSandboxFs(
  current: () => RuntimeFs,
  mutate: <T>(operation: () => Promise<T>) => Promise<T>,
): RuntimeFs {
  function readFile(path: string): Promise<Uint8Array>;
  function readFile(
    path: string,
    encoding: 'utf8' | { readonly encoding: 'utf8' },
  ): Promise<string>;
  async function readFile(
    path: string,
    encoding?: 'utf8' | { readonly encoding: 'utf8' },
  ): Promise<Uint8Array | string> {
    return encoding === undefined ? current().readFile(path) : current().readFile(path, encoding);
  }
  return {
    readFile,
    writeFile: (path, data) => mutate(() => current().writeFile(path, data)),
    readdir: async (path) => current().readdir(path),
    stat: async (path) => current().stat(path),
    mkdir: (path, options) => mutate(() => current().mkdir(path, options)),
    rename: (source, target) => mutate(() => current().rename(source, target)),
    rm: (path, options) => mutate(() => current().rm(path, options)),
    flush: () => mutate(() => current().flush()),
  };
}
