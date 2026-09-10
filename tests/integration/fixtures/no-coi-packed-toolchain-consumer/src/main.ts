import {
  type SandboxResidentBin,
  type SandboxStartBinInput,
  type SandboxToolchain,
  type ToolchainCreateSandboxOptions,
  type ToolchainSandbox,
  createSandbox,
} from '@riftydev/sdk';

export { agentFilesScenario, agentCommandsScenario, agentStopScenario } from './agent-scenarios';

export async function bootToolchain(
  workerUrl: string | URL,
  vmEngine?: ToolchainCreateSandboxOptions['vmEngine'],
): Promise<ToolchainSandbox> {
  return await createSandbox({
    requireCrossOriginIsolation: false,
    skipServiceWorker: true,
    toolchain: { workerUrl },
    vmEngine,
  });
}

export async function startInstalledTool(
  toolchain: SandboxToolchain,
  input: SandboxStartBinInput,
): Promise<SandboxResidentBin> {
  return await toolchain.startBin(input);
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

export { agentInstalledBuildScenario } from './agent-installed-scenario';
