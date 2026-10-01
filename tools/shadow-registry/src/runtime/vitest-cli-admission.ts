import { NotImplementedError } from '@riftydev/io';
import { type FsSync, basename, dirname, isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';

export interface InstalledCliAdmission {
  readonly fs: FsSync;
  readonly specifier: string;
  readonly fromFile: string;
  readonly args: readonly string[];
  readonly importModule: (specifier: string, fromFile: string) => Promise<unknown>;
}
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function manifest(fs: FsSync, root: string): Record<string, unknown> | null {
  const path = joinPath(root, 'package.json');
  return fs.existsSync(path)
    ? record(JSON.parse(new TextDecoder().decode(fs.readFileBytesSync(path))))
    : null;
}
function entryPackage(
  options: InstalledCliAdmission,
): { root: string; package: Record<string, unknown> } | null {
  const target = isAbsolute(options.specifier)
    ? normalizePath(options.specifier)
    : normalizePath(joinPath(dirname(options.fromFile), options.specifier));
  let root = dirname(target);
  for (;;) {
    const pkg = manifest(options.fs, root);
    if (pkg) {
      if (pkg.name !== 'vitest') return null;
      const bin = typeof pkg.bin === 'string' ? pkg.bin : record(pkg.bin)?.vitest;
      return typeof bin === 'string' && normalizePath(joinPath(root, bin)) === target
        ? { root, package: pkg }
        : null;
    }
    if (root === '/') return null;
    root = dirname(root);
  }
}
function viteVersion(fs: FsSync, from: string): unknown {
  let dir = from;
  for (;;) {
    if (basename(dir) !== 'node_modules') {
      const pkg = manifest(fs, joinPath(dir, 'node_modules/vite'));
      if (pkg) return pkg.version;
    }
    if (dir === '/') return undefined;
    dir = dirname(dir);
  }
}
function enabled(value: unknown): boolean {
  return value === true || record(value)?.enabled === true;
}

/** Native public parser, shared entry loader; finite admission never rewrites argv/source. */
export async function admitInstalledCliEntry(
  options: InstalledCliAdmission,
): Promise<undefined | 'handled'> {
  const identity = entryPackage(options);
  if (!identity) return;
  if (identity.package.version !== '4.1.11') throw new NotImplementedError('vitest.version');
  if (viteVersion(options.fs, identity.root) !== '8.0.16')
    throw new NotImplementedError('vitest.vite-version');
  if (options.args.length === 1 && ['--help', '-h', '--version', '-v'].includes(options.args[0]!))
    return;
  if (options.args[0] !== 'run') {
    const watch =
      options.args.length === 0 ||
      (options.args.length === 1 && ['--watch', '-w', 'watch', 'dev'].includes(options.args[0]!));
    throw new NotImplementedError(
      watch ? 'vitest.watch' : 'vitest.cli-shape',
      'only canonical run and root info are admitted',
    );
  }
  const module = record(
    await options.importModule('vitest/node', joinPath(identity.root, 'vitest.mjs')),
  );
  const parse = module?.parseCLI;
  if (typeof parse !== 'function') throw new NotImplementedError('vitest.cli.parser');
  const parsed = record(Reflect.apply(parse, undefined, [['vitest', ...options.args]]));
  const config = record(parsed?.options);
  if (!config) throw new TypeError('Vitest parser returned no option snapshot');
  if (config.help) return 'handled';
  if (config.watch)
    throw new NotImplementedError(
      'vitest.watch',
      'only explicit run and native help/version are admitted',
    );
  if (config.pool === 'vmThreads' || config.pool === 'vmForks')
    throw new NotImplementedError(`vitest.pool.${config.pool}`);
  if (config.dom === true) throw new NotImplementedError('vitest.environment.happy-dom');
  if (enabled(config.typecheck) || record(config.typecheck)?.only === true)
    throw new NotImplementedError('vitest.typecheck');
  if (config.environment === 'jsdom' || config.environment === 'happy-dom')
    throw new NotImplementedError(`vitest.environment.${config.environment}`);
  if (enabled(config.coverage)) throw new NotImplementedError('vitest.coverage');
  if (enabled(config.browser)) throw new NotImplementedError('vitest.browser');
}
