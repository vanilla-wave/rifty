import { createSandbox } from '@riftydev/sdk';

export async function proveCopiedToolchain(workerUrl: string): Promise<void> {
  const sandbox = await createSandbox({
    requireCrossOriginIsolation: false,
    toolchain: { workerUrl },
    vmEngine: 'rewrite',
  });
  try {
    const result = await sandbox.runtime.eval("require('node:vm').runInNewContext('40 + 2')");
    if (!result.ok || result.value !== 42) {
      throw new Error(`Copied worker/compiler closure failed: ${JSON.stringify(result)}`);
    }
  } finally {
    sandbox.dispose();
  }
}
