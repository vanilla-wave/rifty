import type { SandboxToolchain } from '@riftydev/sdk';

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

// @ts-expect-error binPath is required
void toolchain.runBin({ cwd: '/project', args: [] });
// @ts-expect-error runBin rejects extra fields
void toolchain.runBin({
  cwd: '/project',
  binPath: '/project/node_modules/.bin/arbitrary-tool',
  args: [],
  queue: true,
});
// @ts-expect-error args is a readonly string array
void toolchain.runBin({ cwd: '/project', binPath: '/project/node_modules/.bin/tool', args: 'x' });

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
// @ts-expect-error public toolchain rejects extra methods
const extraMethod: SandboxToolchain = {
  install: async () => {},
  runBin: async () => ({ exitCode: 0 }),
  reconnect: async () => {},
};
void extraMethod;
