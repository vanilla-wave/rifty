import assert from 'node:assert/strict';
import { withClientServer } from './client-bundle-browser-proof.mjs';

export async function provePackedAgent(root, registryUrl) {
  await withClientServer(root, async (browser, base) => {
    for (const scenario of [
      'agentFilesScenario',
      'agentCommandsScenario',
      'agentStopScenario',
      'agentInstalledBuildScenario',
    ]) {
      const context = await browser.newContext();
      let timer;
      try {
        const page = await context.newPage();
        await page.goto(base);
        const observed = await Promise.race([
          page.evaluate(
            async ({ scenario, registryUrl }) => {
              const api = await import('/dist/main.js');
              const sandbox = await api.bootToolchain('/dist/worker.js');
              try {
                return {
                  coi: crossOriginIsolated,
                  result: await api[scenario](sandbox, registryUrl),
                };
              } finally {
                sandbox.dispose();
              }
            },
            { scenario, registryUrl },
          ),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Packed ${scenario} timed out`)), 180_000);
          }),
        ]);
        assert.equal(observed.coi, false);
        const value = observed.result;
        if (scenario === 'agentFilesScenario') {
          for (const key of ['content', 'raw']) assert.equal(value[key], 'hello');
          assert.equal(value.retained, 'keep');
          assert.equal(value.rawAnchored, 'root');
          assert.equal(value.stat.isFile, true);
          assert.equal(value.stat.size, 5);
          assert.deepEqual(value.list, [{ name: 'a.txt', isDirectory: false, isFile: true }]);
          for (const key of ['mkdir', 'rename', 'rm'])
            assert.deepEqual(value[key], { applied: 'yes', persistence: 'flushed' });
          for (const key of ['denied', 'deniedMove']) assert.equal(value[key].code, 'EROFS');
          for (const key of ['missing', 'removed']) assert.equal(value[key].code, 'ENOENT');
        } else if (scenario === 'agentCommandsScenario') {
          assert.equal(value.first.status, 'exited');
          assert.equal(value.first.exitCode, 0);
          assert.equal(value.first.stdout, '/commands/src\n');
          assert.equal(value.next.stdout, '/commands\n\n');
          assert.notEqual(value.failed.exitCode, 0);
          assert.equal(value.afterFailed.stdout, '/commands\n');
          assert.equal(value.output.status, 'exited');
          assert.equal(value.output.stdout, 'AC');
          assert.equal(value.output.stderr, 'B');
          assert.deepEqual(value.events, ['stdout:A', 'stderr:B', 'stdout:C', 'complete']);
          for (const key of ['guestDenied', 'redirectDenied', 'background', 'executionDenied'])
            assert.notEqual(value[key].exitCode, 0);
          assert.equal(value.backgroundFile.code, 'ENOENT');
          assert.equal(value.forbidden.code, 'ENOENT');
          assert.equal(value.retained, 'keep');
          assert.equal(value.effect, 'saved\n');
          assert.equal(value.built, 'built\n');
          assert.equal(value.npm.exitCode, 0);
        } else if (scenario === 'agentStopScenario') {
          assert.equal(value.overlap.status, 'failed');
          assert.equal(value.overlap.error.name, 'SandboxToolchainBusyError');
          assert.equal(value.stopped.status, 'cancelled');
          assert.equal(value.stopped.worker, 'retained');
          assert.equal(value.stopped.effects.persistence, 'flushed');
          assert.equal(value.same, true);
          assert.equal(value.effect, 'applied\n');
          assert.equal(value.next.stdout, '/stop\nnext\n');
          assert.equal(value.terminated.status, 'cancelled');
          assert.equal(value.terminated.worker, 'replaced');
          assert.deepEqual(value.terminated.effects, {
            applied: 'unknown',
            persistence: 'unknown',
          });
          assert.equal(value.afterHard.status, 'exited');
          assert.equal(value.afterHard.exitCode, 0);
          assert.equal(value.afterHard.stdout, 'after-hard\n');
        } else {
          assert.equal(value.version, '7.3.6');
          for (const result of [value.first, value.rebuild]) {
            assert.equal(result.status, 'exited');
            assert.equal(result.exitCode, 0);
            assert.equal(result.worker, 'retained');
            assert.deepEqual(result.effects, { applied: 'yes', persistence: 'flushed' });
          }
          assert(value.firstOutput.join('\n').includes('agent-first-build'));
          assert(value.output.join('\n').includes('agent-edited-build'));
          assert(!value.output.join('\n').includes('agent-first-build'));
          assert.notEqual(value.forbidden.exitCode, 0);
          assert.equal(value.retained, 'keep');
          assert.equal(value.next.status, 'exited');
          assert.equal(value.next.exitCode, 0);
          assert.equal(value.next.stdout, '/agent-build\nafter-build\n');
        }
        console.log(`Packed ${scenario}: passed`);
      } finally {
        clearTimeout(timer);
        await context.close();
      }
    }
  });
}
