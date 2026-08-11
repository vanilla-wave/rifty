import { describe, expect, it } from 'vitest';
import * as processIdentity from './process-identity.ts';

describe('process identity public surface', () => {
  it('does not publish process-instance construction helpers', () => {
    expect(Object.keys(processIdentity).sort()).toEqual([
      'NODE_PROCESS_IDENTITY',
      'createNodeProcessRelease',
    ]);
  });
});
