import { describe, expect, it } from 'vitest';
import type { OwnerToPageFrame } from '../glue/pty-protocol.ts';
import { HOST_PREVIEW_ORIGIN, createPreviewRegistry } from './preview-registry.ts';

describe('preview-registry prefixed URLs (I5)', () => {
  it('emits /sandbox/preview/<port>/ when a prefix is selected', () => {
    const sent: OwnerToPageFrame[] = [];
    const deps = {
      send: (frame: OwnerToPageFrame) => sent.push(frame),
      previewPrefix: '/sandbox/preview',
    };
    const reg = createPreviewRegistry(deps);
    reg.addNode('s1', [5173], 'scope-node', { pid: 2, origin: HOST_PREVIEW_ORIGIN });
    const preview = sent.find(
      (frame): frame is Extract<OwnerToPageFrame, { type: 'pty:preview' }> =>
        frame.type === 'pty:preview',
    );
    expect(preview?.ports[0]?.url).toBe('/sandbox/preview/5173/');
  });
});
