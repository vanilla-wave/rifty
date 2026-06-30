import { describe, expect, it } from 'vitest';
import {
  type DevServerChildMessage,
  type DevServerOwnerMessage,
  isDevServerChildMessage,
  isDevServerOwnerMessage,
} from './dev-server-ipc.ts';

describe('dev-server-ipc guards', () => {
  it('accepts child→owner frames', () => {
    const ready: DevServerChildMessage = {
      type: 'rifty:dev-ready',
      port: 5174,
      previewScope: 'dev-scope',
    };
    const preview: DevServerChildMessage = {
      type: 'rifty:preview-ready',
      port: 4173,
      previewScope: 'preview-scope',
    };
    const error: DevServerChildMessage = { type: 'rifty:dev-error', message: 'boom' };
    const snap: DevServerChildMessage = { type: 'rifty:dev-snapshot' };
    expect(isDevServerChildMessage(ready)).toBe(true);
    expect(isDevServerChildMessage(preview)).toBe(true);
    expect(isDevServerChildMessage(error)).toBe(true);
    expect(isDevServerChildMessage(snap)).toBe(true);
  });

  it('accepts owner→child frames', () => {
    const fc: DevServerOwnerMessage = {
      type: 'rifty:dev-file-changed',
      path: '/workspace/src/main.js',
    };
    expect(isDevServerOwnerMessage(fc)).toBe(true);
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
    expect(isDevServerChildMessage(null)).toBe(false);
    expect(isDevServerOwnerMessage({ type: 'rifty:dev-file-changed' })).toBe(false); // missing path
    expect(isDevServerOwnerMessage({ type: 'rifty:dev-file-changed', path: 42 })).toBe(false); // path wrong type
    expect(isDevServerOwnerMessage('rifty:dev-file-changed')).toBe(false);
  });
});
