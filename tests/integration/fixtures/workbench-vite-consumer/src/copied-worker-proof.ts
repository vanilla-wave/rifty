import { createSandbox } from '@riftydev/sdk';

export async function proveCopiedToolchain(workerUrl: string): Promise<void> {
  const sandbox = await createSandbox({
    requireCrossOriginIsolation: false,
    toolchain: { workerUrl },
    vmEngine: 'rewrite',
  });
  try {
    let stdout = '';
    sandbox.runtime.on((event) => {
      if (event.type === 'stdout') stdout += event.chunk;
    });
    const result = await sandbox.runtime.eval(
      "console.log(require('node:vm').runInNewContext('40 + 2')); void 0",
    );
    if (!result.ok || stdout !== '42\n') {
      throw new Error(
        `Copied worker/compiler closure failed: ${JSON.stringify({ result, stdout })}`,
      );
    }
  } finally {
    sandbox.dispose();
  }
}
