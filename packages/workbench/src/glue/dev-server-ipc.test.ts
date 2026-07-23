import { describe, expect, it } from 'vitest';
import { type DevServerChildMessage, isDevServerChildMessage } from './dev-server-ipc.ts';

describe('dev-server-ipc guards', () => {
  it('accepts child→owner frames', () => {
    const ready: DevServerChildMessage = {
      type: 'rifty:dev-ready',
      port: 5174,
      previewScope: 'dev-scope',
    };
    const error: DevServerChildMessage = { type: 'rifty:dev-error', message: 'boom' };
    const snap: DevServerChildMessage = { type: 'rifty:dev-snapshot' };
    const ports: DevServerChildMessage = { type: 'rifty:dev-ports', ports: [] };
    const portsFull: DevServerChildMessage = {
      type: 'rifty:dev-ports',
      ports: [5174, 5175],
      previewScope: 'dev-scope',
    };
    expect(isDevServerChildMessage(ready)).toBe(true);
    expect(isDevServerChildMessage(error)).toBe(true);
    expect(isDevServerChildMessage(snap)).toBe(true);
    expect(isDevServerChildMessage(ports)).toBe(true);
    expect(isDevServerChildMessage(portsFull)).toBe(true);
  });

  it('rejects foreign / malformed messages', () => {
    expect(isDevServerChildMessage({ type: 'pty:ipc' })).toBe(false);
    expect(isDevServerChildMessage({ type: 'rifty:dev-ready' })).toBe(false); // missing port
    expect(isDevServerChildMessage({ type: 'rifty:dev-ready', port: '5174' })).toBe(false); // port wrong type
    expect(isDevServerChildMessage({ type: 'rifty:dev-ready', port: Number.NaN })).toBe(false); // NaN port
    expect(isDevServerChildMessage({ type: 'rifty:dev-ready', port: 5174, previewScope: 42 })).toBe(
      false,
    ); // scope wrong type
    expect(isDevServerChildMessage({ type: 'rifty:dev-error', message: null })).toBe(false); // message wrong type
    expect(isDevServerChildMessage({ type: 'rifty:dev-ports' })).toBe(false); // missing ports
    expect(isDevServerChildMessage({ type: 'rifty:dev-ports', ports: [5174, 'x'] })).toBe(false); // port wrong type
    expect(isDevServerChildMessage({ type: 'rifty:dev-ports', ports: [1.5] })).toBe(false); // non-integer port
    expect(isDevServerChildMessage(null)).toBe(false);
  });
});
