import { describe, expect, it } from 'vitest';
import type { OwnerToPageFrame } from '../glue/pty-protocol.ts';
import { createPreviewRegistry } from './preview-registry.ts';

function frames() {
  const sent: OwnerToPageFrame[] = [];
  return { send: (f: OwnerToPageFrame) => sent.push(f), sent };
}

function previewFrames(sent: OwnerToPageFrame[]) {
  return sent.filter(
    (f): f is Extract<OwnerToPageFrame, { type: 'pty:preview' }> => f.type === 'pty:preview',
  );
}

describe('preview-registry', () => {
  it('emits a snapshot on add and remove', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.addNode('s1', [3000], 'scope-node-1');
    expect(previewFrames(sent).at(-1)).toEqual({
      type: 'pty:preview',
      ports: [
        {
          port: 3000,
          url: '/preview/3000/',
          label: 'node :3000',
          source: 'node',
          sid: 's1',
          previewScope: 'scope-node-1',
        },
      ],
    });
    reg.removeBySid('s1');
    expect(previewFrames(sent).at(-1)).toEqual({ type: 'pty:preview', ports: [] });
  });

  it('dev-server is a single replace-by-source slot', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.setDevServer(5174, 'scope-dev-1');
    reg.setDevServer(5175, 'scope-dev-2');
    expect(
      previewFrames(sent)
        .at(-1)!
        .ports.filter((p) => p.source === 'dev-server'),
    ).toEqual([
      {
        port: 5175,
        url: '/preview/5175/',
        label: 'npm run dev',
        source: 'dev-server',
        sid: 'dev-server',
        previewScope: 'scope-dev-2',
      },
    ]);
    reg.clearDevServer();
    expect(previewFrames(sent).at(-1)!.ports).toEqual([]);
  });

  it('production preview is a single replace-by-source slot distinct from dev-server', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.setDevServer(5174, 'scope-dev');
    reg.setPreview(4173, 'scope-preview-1');
    reg.setPreview(4174, 'scope-preview-2');
    expect(previewFrames(sent).at(-1)!.ports).toEqual([
      {
        port: 5174,
        url: '/preview/5174/',
        label: 'npm run dev',
        source: 'dev-server',
        sid: 'dev-server',
        previewScope: 'scope-dev',
      },
      {
        port: 4174,
        url: '/preview/4174/',
        label: 'vite preview',
        source: 'preview',
        sid: 'preview',
        previewScope: 'scope-preview-2',
      },
    ]);
    reg.clearPreview();
    expect(
      previewFrames(sent)
        .at(-1)!
        .ports.map((p) => p.source),
    ).toEqual(['dev-server']);
  });

  it('publish() re-emits the current set (handshake)', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.addNode('s1', [3000], 'scope-node');
    sent.length = 0;
    reg.publish();
    expect(sent).toHaveLength(1);
    expect(previewFrames(sent)[0]!.ports).toHaveLength(1);
  });

  it('multiple node ports + dev-server coexist in order', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.setDevServer(5174, 'scope-dev');
    reg.addNode('s1', [3000], 'scope-node-1');
    reg.addNode('s2', [8080, 8081], 'scope-node-2');
    expect(
      previewFrames(sent)
        .at(-1)!
        .ports.map((p) => p.port),
    ).toEqual([5174, 3000, 8080, 8081]);
  });

  it('dedups a node port that collides with the dev-server port — dev wins (C3)', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.setDevServer(5174, 'scope-dev');
    // A `node server.js` that picked the SAME port (no PORT injection, ADR-0155 §4)
    // must NOT be double-listed: the SW routes one /preview/5174/, so two entries
    // would make the page wire two clobbering bridges whose teardown deletes the
    // shared route. The dev slot wins; the distinct node port stays.
    reg.addNode('s1', [5174, 4001], 'scope-node');
    const ports = previewFrames(sent).at(-1)!.ports;
    expect(ports.map((p) => p.port)).toEqual([5174, 4001]);
    expect(ports.find((p) => p.port === 5174)?.source).toBe('dev-server');
  });

  it('labels a bin entry by its labelBase', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.addNode('bin-1', [8080], 'scope-bin', { labelBase: 'webpack-dev-server' });
    const ports = previewFrames(sent).at(-1)!.ports;
    expect(ports[0]?.label).toBe('webpack-dev-server :8080');
  });
});

function devFrames(sent: OwnerToPageFrame[]) {
  return sent.filter(
    (f): f is Extract<OwnerToPageFrame, { type: 'pty:dev-server' }> => f.type === 'pty:dev-server',
  );
}

// The registry is the SINGLE authority for `pty:dev-server` frames: the pill is
// DERIVED from the listening-port set (any guest server counts — vite, webpack,
// bare node:http), never from a bin-name check. Backlog:
// playground/generic-dev-server-lifecycle.
describe('preview-registry derived dev-server lifecycle', () => {
  it('any first listening entry → running frame with port + ptySid; emptying → stopped', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.addNode('bin-1', [8080], 'scope-1', { ptySid: 'term-1', labelBase: 'webpack' });
    expect(devFrames(sent).at(-1)).toEqual({
      type: 'pty:dev-server',
      status: 'running',
      sid: 'term-1',
      port: 8080,
      url: '/preview/8080/',
      previewScope: 'scope-1',
    });
    reg.removeBySid('bin-1');
    expect(devFrames(sent).at(-1)).toEqual({
      type: 'pty:dev-server',
      status: 'stopped',
      sid: 'term-1',
    });
  });

  it('a server that closes its port (ports → []) reads as stopped, without an exit', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.addNode('node-1', [3000], 'scope-1', { ptySid: 'term-1' });
    reg.addNode('node-1', [], 'scope-1', { ptySid: 'term-1' });
    expect(devFrames(sent).at(-1)?.status).toBe('stopped');
  });

  it('no duplicate running frames while the primary is unchanged', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.addNode('node-1', [3000], 'scope-1', { ptySid: 'term-1' });
    const before = devFrames(sent).length;
    reg.addNode('node-2', [4000], 'scope-2', { ptySid: 'term-2' });
    expect(devFrames(sent)).toHaveLength(before);
  });

  it('primary handover: first server closes → running frame for the next port', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.addNode('node-1', [3000], 'scope-1', { ptySid: 'term-1' });
    reg.addNode('node-2', [4000], 'scope-2', { ptySid: 'term-2' });
    reg.removeBySid('node-1');
    expect(devFrames(sent).at(-1)).toMatchObject({ status: 'running', port: 4000, sid: 'term-2' });
  });

  it('controller path: devStarting → starting; setDevServer → running; devStopped → stopped', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.devStarting('term-1');
    expect(devFrames(sent).at(-1)).toEqual({
      type: 'pty:dev-server',
      status: 'starting',
      sid: 'term-1',
    });
    reg.setDevServer(5174, 'scope-dev', 'term-1');
    expect(devFrames(sent).at(-1)).toMatchObject({ status: 'running', port: 5174, sid: 'term-1' });
    reg.devStopped();
    expect(devFrames(sent).at(-1)).toMatchObject({ status: 'stopped', sid: 'term-1' });
  });

  it('devBootFailed → stopped frame with error', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.devStarting('term-1');
    reg.devBootFailed('boom', 'term-1');
    expect(devFrames(sent).at(-1)).toEqual({
      type: 'pty:dev-server',
      status: 'stopped',
      sid: 'term-1',
      error: 'boom',
    });
  });

  it('devBootFailed with ANOTHER server live keeps the derived running status (error still carried)', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.addNode('node-1', [3000], 'scope-1', { ptySid: 'term-1' });
    reg.devStarting('term-2');
    reg.devBootFailed('boom', 'term-2');
    // A live server keeps the derived status truthful — a forced global
    // 'stopped' would flip the page pill off while :3000 still serves.
    expect(devFrames(sent).at(-1)).toMatchObject({
      status: 'running',
      port: 3000,
      sid: 'term-1',
      error: 'boom',
    });
  });

  it('a listening port wins over a concurrent starting phase (running > starting)', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.addNode('node-1', [3000], 'scope-1', { ptySid: 'term-1' });
    reg.devStarting('term-2');
    expect(devFrames(sent).at(-1)?.status).toBe('running');
  });

  it('publishDev() re-emits the current derived frame (handshake)', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.addNode('node-1', [3000], 'scope-1', { ptySid: 'term-1' });
    sent.length = 0;
    reg.publishDev();
    expect(devFrames(sent).at(-1)).toMatchObject({ status: 'running', port: 3000 });
  });

  it('carries the owner-reported command cwd on derived running frames', () => {
    // The page records the reload-restore command from this frame — its session
    // cache is stale mid-run ('/'), so the OWNER cwd is the only honest source.
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.addNode('bin-1', [8080], 'scope-1', { ptySid: 'term-1', cwd: '/scratch' });
    expect(devFrames(sent).at(-1)).toMatchObject({ status: 'running', cwd: '/scratch' });
    reg.removeBySid('bin-1');
    reg.setDevServer(5174, 'scope-dev', 'term-2', '/projects/p1');
    expect(devFrames(sent).at(-1)).toMatchObject({ status: 'running', cwd: '/projects/p1' });
  });
});
