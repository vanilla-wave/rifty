import { type SandboxToolchain, type ToolchainSandbox, createSandbox } from '@riftydev/sdk';

export async function bootToolchain(workerUrl: string | URL): Promise<ToolchainSandbox> {
  return await createSandbox({
    requireCrossOriginIsolation: false,
    toolchain: { workerUrl },
    skipServiceWorker: true,
  });
}

export async function runInstalledTool(
  toolchain: SandboxToolchain,
  registryUrl: string,
): Promise<number> {
  await toolchain.install({ cwd: '/project', registryUrl });
  const result = await toolchain.runBin({
    cwd: '/project',
    binPath: '/project/node_modules/.bin/arbitrary-tool',
    args: ['--version'],
  });
  return result.exitCode;
}
