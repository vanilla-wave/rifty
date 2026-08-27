import { expect, test } from '@playwright/test';
import { childFsScenario } from '../../tools/perf/child-fs/scenario.mjs';
import { gotoHarness, sealedWorkbenchFixtureUrl } from './fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const laneFixtureUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/child-fs-product-lane.ts`;

test('non-COI rejects before open; every post-open failure closes once', async ({ page }) => {
  await gotoHarness(page);
  const result = await page.evaluate(
    async ({ dependencies, laneUrl, sealedUrl }) => {
      const [lane, sealed] = await Promise.all([
        import(/* @vite-ignore */ laneUrl),
        import(/* @vite-ignore */ sealedUrl),
      ]);
      let falseCoiOpenCalls = 0;
      let falseCoiOtherCalls = 0;
      const rejectFalseCoiCall = async () => {
        falseCoiOtherCalls += 1;
        throw new Error('non-COI host method must not be called');
      };
      let falseCoiRejected = false;
      try {
        await lane.runChildFsProductLane(1, {
          coi: false,
          open: async () => {
            falseCoiOpenCalls += 1;
          },
          writeText: rejectFalseCoiCall,
          execute: rejectFalseCoiCall,
          readdir: rejectFalseCoiCall,
          readText: rejectFalseCoiCall,
          close: rejectFalseCoiCall,
        });
      } catch {
        falseCoiRejected = true;
      }

      let closeCalls = 0;
      let commandRejected = false;
      try {
        await lane.runChildFsProductLane(1, {
          coi: true,
          open: (plan: unknown) =>
            sealed.openSealedWorkbenchFixture({
              workspaceId: 'child-fs-product-lane-fault',
              persistence: 'ephemeral',
              plan,
            }),
          execute: async () => {
            throw new Error('injected install failure');
          },
          close: async () => {
            closeCalls += 1;
            await sealed.closeSealedWorkbenchFixture();
          },
        });
      } catch (error) {
        commandRejected = String(error).includes('injected install failure');
      }
      let ownershipClosed = false;
      try {
        sealed.currentProject();
      } catch {
        ownershipClosed = true;
      }

      const cleanupSweep: Array<{
        readonly closeCalls: number;
        readonly failureAt: number;
        readonly rejected: boolean;
      }> = [];
      const marker = 'product-coi-1';
      const successfulOutcome = (out: string) => ({
        exitCode: 0,
        exit: { code: 0, signal: null },
        closeExit: { code: 0, signal: null },
        closeShared: true,
        settlements: 1,
        out,
      });
      let ordinalOneMarkerWrite: { readonly contents: string; readonly path: string } | null = null;
      for (let failureAt = 1; failureAt <= 14; failureAt += 1) {
        let operationCalls = 0;
        let sweepCloseCalls = 0;
        const failAtBoundary = () => {
          operationCalls += 1;
          if (operationCalls === failureAt) throw new Error(`injected boundary ${failureAt}`);
        };
        let rejected = false;
        try {
          await lane.runChildFsProductLane(1, {
            coi: true,
            open: async () => {},
            execute: async (line: string) => {
              failAtBoundary();
              if (line === 'vite build') {
                return successfulOutcome('✓ 2180 modules transformed.\n✓ built in 1s\n');
              }
              if (line.startsWith('node express-anchor.cjs ')) {
                return successfulOutcome(
                  failureAt === 14
                    ? 'corrupt express proof\n'
                    : `RIFTY_EXPRESS_READY ${marker} 1\nRIFTY_EXPRESS_CLOSED ${marker}\n`,
                );
              }
              return successfulOutcome('npm: installed\n');
            },
            writeText: async (path: string, contents: string) => {
              failAtBoundary();
              if (failureAt === 10) ordinalOneMarkerWrite = { contents, path };
            },
            readdir: async () => {
              failAtBoundary();
              return [{ path: '/dist/assets/index.js', kind: 'file' }];
            },
            readText: async (path: string) => {
              failAtBoundary();
              if (path === '/dist/assets/index.js') return `const marker="${marker}";\n`;
              const prefix = '/node_modules/';
              const suffix = '/package.json';
              const dependency = path.slice(prefix.length, -suffix.length);
              return `${JSON.stringify({ version: dependencies[dependency] })}\n`;
            },
            close: async () => {
              sweepCloseCalls += 1;
            },
          });
        } catch (error) {
          rejected =
            failureAt === 14
              ? String(error).includes('ready and one close proof')
              : String(error).includes(`injected boundary ${failureAt}`);
        }
        cleanupSweep.push({ closeCalls: sweepCloseCalls, failureAt, rejected });
      }
      return {
        cleanupSweep,
        falseCoiOpenCalls,
        falseCoiOtherCalls,
        falseCoiRejected,
        closeCalls,
        commandRejected,
        ordinalOneMarkerWrite,
        ownershipClosed,
      };
    },
    {
      dependencies: childFsScenario().dependencies,
      laneUrl: laneFixtureUrl,
      sealedUrl: sealedWorkbenchFixtureUrl,
    },
  );

  expect(result).toMatchObject({
    falseCoiOpenCalls: 0,
    falseCoiOtherCalls: 0,
    falseCoiRejected: true,
    closeCalls: 1,
    commandRejected: true,
    ownershipClosed: true,
  });
  expect(result.cleanupSweep).toEqual(
    Array.from({ length: 14 }, (_, index) => ({
      closeCalls: 1,
      failureAt: index + 1,
      rejected: true,
    })),
  );
  const panelSeed = childFsScenario().files['/src/Panel.jsx'];
  if (panelSeed === undefined) throw new TypeError('canonical Panel seed is missing');
  expect(result.ordinalOneMarkerWrite).toEqual({
    contents: panelSeed.replace('bench-seed', 'product-coi-1').replace('bench-seed', 'run-1'),
    path: '/src/Panel.jsx',
  });
});
