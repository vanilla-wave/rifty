import { describe, expect, it } from 'vitest';
import { isNodeChildMessage } from './node-child-ipc.ts';

describe('node-child-ipc', () => {
  it('accepts a rifty:node-listening message', () => {
    expect(isNodeChildMessage({ type: 'rifty:node-listening', ports: [3000, 8080] })).toBe(true);
  });
  it('rejects foreign / malformed messages', () => {
    expect(isNodeChildMessage({ type: 'rifty:dev-ready', port: 1 })).toBe(false);
    expect(isNodeChildMessage({ type: 'rifty:node-listening' })).toBe(false);
    expect(isNodeChildMessage(null)).toBe(false);
  });
});
