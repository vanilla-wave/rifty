import { describe, expect, it } from 'vitest';
import type { OwnerToPageFrame } from '../glue/pty-protocol.ts';
import { createPreviewRegistry } from './preview-registry.ts';

function frames() {
  const sent: OwnerToPageFrame[] = [];
  return { send: (f: OwnerToPageFrame) => sent.push(f), sent };
}

describe('preview-registry', () => {
  it('emits a snapshot on add and remove', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.addNode('s1', [3000]);
    expect(sent.at(-1)).toEqual({
      type: 'pty:preview',
      ports: [{ port: 3000, url: '/preview/3000/', label: 'node :3000', source: 'node', sid: 's1' }],
    });
    reg.removeBySid('s1');
    expect(sent.at(-1)).toEqual({ type: 'pty:preview', ports: [] });
  });

  it('dev-server is a single replace-by-source slot', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.setDevServer(5174);
    reg.setDevServer(5175);
    expect((sent.at(-1) as Extract<OwnerToPageFrame, { type: 'pty:preview' }>).ports.filter((p) => p.source === 'dev-server')).toEqual([
      { port: 5175, url: '/preview/5175/', label: 'npm run dev', source: 'dev-server', sid: 'dev-server' },
    ]);
    reg.clearDevServer();
    expect((sent.at(-1) as Extract<OwnerToPageFrame, { type: 'pty:preview' }>).ports).toEqual([]);
  });

  it('publish() re-emits the current set (handshake)', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.addNode('s1', [3000]);
    sent.length = 0;
    reg.publish();
    expect(sent).toHaveLength(1);
    expect((sent[0] as Extract<OwnerToPageFrame, { type: 'pty:preview' }>).ports).toHaveLength(1);
  });

  it('multiple node ports + dev-server coexist in order', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.setDevServer(5174);
    reg.addNode('s1', [3000]);
    reg.addNode('s2', [8080, 8081]);
    expect((sent.at(-1) as Extract<OwnerToPageFrame, { type: 'pty:preview' }>).ports.map((p) => p.port)).toEqual([5174, 3000, 8080, 8081]);
  });
});
