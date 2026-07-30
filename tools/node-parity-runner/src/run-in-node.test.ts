import { describe, expect, it } from 'vitest';
import { runInNode } from './run-in-node.ts';

describe('runInNode', () => {
  it('terminates a real native oracle that exceeds the per-case timeout', async () => {
    await expect(
      runInNode(
        {
          code: 'setTimeout(() => process.exit(0), 500);',
        },
        { timeoutMs: 50 },
      ),
    ).rejects.toThrow('Node parity case timed out after 50ms');
  });
});
