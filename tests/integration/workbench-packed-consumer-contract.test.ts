import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { hostBuiltinAliases } from './fixtures/workbench-vite-consumer/host-builtins';
import { assertExactFirstPartyImports } from './workbench-packed-consumer-package-contract.mjs';
import { installedPackagePackPlan } from './workbench-packed-consumer-package-manager.mjs';
import { createResourceCleanup } from './workbench-packed-consumer-resource-cleanup.mjs';

const integrationRoot = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(integrationRoot, 'fixtures/workbench-vite-consumer');
const fixtureTsconfig = resolve(fixtureRoot, 'tsconfig.json');
const fixtureMain = resolve(fixtureRoot, 'src/main.ts');
const runtimeJsManifest = JSON.parse(
  ts.sys.readFile(resolve(integrationRoot, '../../packages/runtime-js/package.json')) ?? '',
);

function readFixtureTypeScriptConfig(): ts.ParsedCommandLine {
  const config = ts.readConfigFile(fixtureTsconfig, ts.sys.readFile);
  if (config.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  }
  return ts.parseJsonConfigFileContent(config.config, ts.sys, fixtureRoot);
}

describe('packed Workbench resource cleanup', () => {
  it('drains resources once in reverse ownership order', async () => {
    const order: string[] = [];
    const resources = createResourceCleanup({
      exit: vi.fn(),
      reportError: vi.fn(),
    });
    resources.register(async () => {
      order.push('first');
    });
    resources.register(async () => {
      order.push('second');
    });

    await resources.cleanup();
    await resources.cleanup();

    expect(order).toEqual(['second', 'first']);
  });

  it('finishes cleanup before exiting for a terminating signal', async () => {
    const order: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const exit = vi.fn((code: number) => {
      order.push(`exit:${code}`);
    });
    const resources = createResourceCleanup({ exit, reportError: vi.fn() });
    resources.register(async () => {
      order.push('cleanup:start');
      await blocked;
      order.push('cleanup:end');
    });

    const handled = resources.handleSignal('SIGTERM');
    await Promise.resolve();
    expect(order).toEqual(['cleanup:start']);

    release();
    await handled;

    expect(order).toEqual(['cleanup:start', 'cleanup:end', 'exit:143']);
    expect(exit).toHaveBeenCalledOnce();
  });
});

describe('packed Workbench consumer TypeScript contract', () => {
  it('skips known dependency declaration internals but typechecks consumer source', () => {
    const config = readFixtureTypeScriptConfig();

    expect(config.options.skipLibCheck).toBe(true);
    expect(config.options.noCheck).not.toBe(true);
    expect(config.fileNames).toContain(fixtureMain);
  });

  it('reports a deliberate consumer source type error', () => {
    const config = readFixtureTypeScriptConfig();
    const defaultReadFile = ts.sys.readFile;
    const host = ts.createCompilerHost(config.options);
    host.readFile = (fileName) => {
      const source = defaultReadFile(fileName);
      if (resolve(fileName) !== fixtureMain || source === undefined) return source;
      return `${source}\nconst packedConsumerTypeError: string = 42;\n`;
    };
    const program = ts.createProgram({
      rootNames: config.fileNames,
      options: config.options,
      host,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);

    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === 2322 && resolve(diagnostic.file?.fileName ?? '') === fixtureMain,
      ),
    ).toBe(true);
  });

  it('maps host builtins only through published runtime-js subpaths', () => {
    expect(Object.keys(hostBuiltinAliases).sort()).toEqual(['fs', 'os', 'path', 'perf_hooks']);
    for (const target of Object.values(hostBuiltinAliases)) {
      expect(target).toMatch(/^@riftydev\/runtime-js\/builtins\/[^/]+$/u);
      const subpath = `.${target.slice('@riftydev/runtime-js'.length)}`;
      expect(runtimeJsManifest.publishConfig.exports[subpath].import).toMatch(/^\.\/dist\//u);
    }
  });
});

describe('packed Workbench first-party package contract', () => {
  it('accepts only an exact declared-to-emitted import set', () => {
    expect(() =>
      assertExactFirstPartyImports(
        new Set(['@riftydev/io', '@riftydev/vfs']),
        new Set(['@riftydev/vfs', '@riftydev/io']),
      ),
    ).not.toThrow();
  });

  it('rejects both bundled declarations and undeclared emitted imports', () => {
    expect(() =>
      assertExactFirstPartyImports(
        new Set(['@riftydev/io', '@riftydev/vfs']),
        new Set(['@riftydev/io', '@riftydev/kernel']),
      ),
    ).toThrow(
      'missing external imports: @riftydev/vfs; undeclared external imports: @riftydev/kernel',
    );
  });
});

describe('packed Workbench host package-manager contract', () => {
  it('materializes installed packages outside the pnpm store before npm pack', () => {
    expect(
      installedPackagePackPlan('/installed/package', '/staging/package', '/tarballs', '/npm-cache'),
    ).toEqual({
      copy: {
        source: '/installed/package',
        destination: '/staging/package',
        options: {
          recursive: true,
          dereference: true,
        },
      },
      command: {
        command: 'npm',
        args: ['pack', '--loglevel=verbose', '--ignore-scripts', '--pack-destination', '/tarballs'],
        options: {
          cwd: '/staging/package',
          timeoutMs: 120_000,
          env: {
            npm_config_cache: '/npm-cache',
            npm_config_offline: 'true',
          },
        },
      },
    });
  });
});
