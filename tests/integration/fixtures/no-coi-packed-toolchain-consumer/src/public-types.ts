import type { SandboxToolchain } from '@riftydev/sdk';

// @ts-expect-error raw toolchain type stays off the runtime root
type RootRuntimeToolchain = import('@riftydev/runtime-js').RuntimeToolchain;
// @ts-expect-error raw toolchain protocol stays off the runtime root
type RootToolchainProtocol = import('@riftydev/runtime-js').ToolchainRequest;

declare const toolchain: SandboxToolchain;

void toolchain.install({ cwd: '/project', registryUrl: 'https://registry.invalid' });
void toolchain.runBin({
  cwd: '/project',
  binPath: '/project/node_modules/.bin/arbitrary-tool',
  args: ['--version'],
});

// @ts-expect-error registryUrl is required
void toolchain.install({ cwd: '/project' });
// @ts-expect-error install rejects extra fields
void toolchain.install({ cwd: '/project', registryUrl: 'https://registry.invalid', retry: true });
// @ts-expect-error cwd is a string
void toolchain.install({ cwd: 1, registryUrl: 'https://registry.invalid' });
// @ts-expect-error registryUrl is a string
void toolchain.install({ cwd: '/project', registryUrl: 1 });

// @ts-expect-error binPath is required
void toolchain.runBin({ cwd: '/project', args: [] });
void toolchain.runBin({
  cwd: '/project',
  binPath: '/project/node_modules/.bin/arbitrary-tool',
  args: [],
  // @ts-expect-error runBin rejects the exact extra queue field
  queue: true,
});
// @ts-expect-error args is a readonly string array
void toolchain.runBin({ cwd: '/project', binPath: '/project/node_modules/.bin/tool', args: 'x' });
// @ts-expect-error runBin cwd is a string
void toolchain.runBin({ cwd: 1, binPath: '/project/node_modules/.bin/tool', args: [] });
// @ts-expect-error binPath is a string
void toolchain.runBin({ cwd: '/project', binPath: 1, args: [] });

type InstallResult = Awaited<ReturnType<SandboxToolchain['install']>>;
const installResult: InstallResult = undefined;
void installResult;
// @ts-expect-error install resolves void, never a result object
const wrongInstallResult: InstallResult = { installed: true };
void wrongInstallResult;

type RunResult = Awaited<ReturnType<SandboxToolchain['runBin']>>;
const result: RunResult = { exitCode: 0 };
void result;
// @ts-expect-error exitCode is numeric
const wrongResult: RunResult = { exitCode: '0' };
void wrongResult;

// @ts-expect-error runBin is required
const missingRunBin: SandboxToolchain = { install: async () => {} };
void missingRunBin;
// @ts-expect-error install is required
const missingInstall: SandboxToolchain = { runBin: async () => ({ exitCode: 0 }) };
void missingInstall;
const extraMethod: SandboxToolchain = {
  install: async () => {},
  runBin: async () => ({ exitCode: 0 }),
  // @ts-expect-error SandboxToolchain rejects the exact extra reconnect method
  reconnect: async () => {},
};
void extraMethod;

void (null as RootRuntimeToolchain | RootToolchainProtocol | null);
