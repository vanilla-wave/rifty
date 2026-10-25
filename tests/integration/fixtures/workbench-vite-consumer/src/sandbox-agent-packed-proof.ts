import { type SandboxSnapshotSource, createSandbox } from '@riftydev/sdk';
import { sandboxAgentCycle } from './sandbox-agent-proof';

const api = {
  async run(snapshot: SandboxSnapshotSource) {
    const sandbox = await createSandbox({
      requireCrossOriginIsolation: false,
      serviceWorkerUrl: '/dist/rifty/sw.js',
      toolchain: { workerUrl: '/dist/rifty/no-coi-toolchain-worker.js' },
    });
    try {
      if (sandbox.swError) throw new Error(sandbox.swError);
      await sandbox.toolchain.applySnapshot({ cwd: '/agent-packed', snapshot });
      const project = sandbox.project({ root: '/agent-packed' });
      const original = 'document.body.textContent = "real packed Vite";';
      await project.fs.writeFile(
        'index.html',
        '<!doctype html><script type="module" src="/main.js"></script>',
      );
      await project.fs.writeFile('main.js', original);
      await project.fs.writeFile(
        'vite.config.js',
        'export default { build: { minify: false, sourcemap: false } };',
      );
      return {
        coi: crossOriginIsolated,
        result: await sandboxAgentCycle(sandbox, {
          root: '/agent-packed',
          path: 'main.js',
          original,
          port: 5193,
        }),
      };
    } finally {
      sandbox.dispose();
    }
  },
};

declare global {
  var packedSandboxAgent: typeof api;
}
globalThis.packedSandboxAgent = api;
