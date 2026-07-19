import { describe, expect, it, vi } from 'vitest';
import { completeCapturedShadowAssetColdPage } from './shadow-asset-cold-playwright.mjs';

describe('shadow-asset cold captured page lifecycle', () => {
  it('settles measurement, stops CDP, then closes the public page boundary', async () => {
    const events: string[] = [];
    const result = await completeCapturedShadowAssetColdPage({
      measure: async () => {
        events.push('measure');
        return { progress: [] };
      },
      stopRecorder: async () => {
        events.push('stop');
        return [{ requestId: 'eddy-source' }];
      },
      close: async () => {
        events.push('close');
        return { projectClosed: true, workbenchClosed: true, lockReacquired: true };
      },
    });

    expect(events).toEqual(['measure', 'stop', 'close']);
    expect(result).toEqual({
      pageEvidence: { progress: [] },
      captured: [{ requestId: 'eddy-source' }],
      cleanup: { projectClosed: true, workbenchClosed: true, lockReacquired: true },
    });
  });

  it.each(['stopRecorder', 'close'] as const)(
    'closes after %s failure and refuses the lifecycle',
    async (failureAt) => {
      const failure = new Error(`${failureAt} failed`);
      const close = vi.fn(async () => {
        if (failureAt === 'close') throw failure;
        return { projectClosed: true, workbenchClosed: true, lockReacquired: true };
      });

      await expect(
        completeCapturedShadowAssetColdPage({
          measure: async () => ({ progress: [] }),
          stopRecorder: async () => {
            if (failureAt === 'stopRecorder') throw failure;
            return [];
          },
          close,
        }),
      ).rejects.toThrow();
      expect(close).toHaveBeenCalledOnce();
    },
  );
});
