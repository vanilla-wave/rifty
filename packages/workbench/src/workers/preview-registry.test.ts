import { describe, expect, it } from 'vitest';
import type { OwnerPtyRunAdmission, OwnerToPageFrame } from '../glue/pty-protocol.ts';
import {
  HOST_PREVIEW_ORIGIN,
  type PreviewProducerOrigin,
  type PreviewRegistry,
  createPreviewRegistry,
} from './preview-registry.ts';

/** Registry unit fixture; producer composition below uses the real PTY actor. */
function actorAdmission(ptySid: string, ptyRid: string): OwnerPtyRunAdmission {
  return Object.freeze({ ptySid, ptyRid }) as OwnerPtyRunAdmission;
}

function ptyOrigin(ptySid: string, ptyRid: string): PreviewProducerOrigin {
  return { kind: 'pty', admission: actorAdmission(ptySid, ptyRid) };
}

function assertPreviewOriginContract(reg: PreviewRegistry): void {
  // @ts-expect-error Dev-server registration must name its producer origin.
  reg.setDevServer(5173, 'scope-dev', {});
  // @ts-expect-error Production-preview registration must name its producer origin.
  reg.setPreview(4173, 'scope-preview');
  // @ts-expect-error A missing origin cannot silently become an uncorrelated source.
  reg.addNode('node-child', [3000], 'scope-node', {});
  // @ts-expect-error Starting state must retain the producer origin before a port exists.
  reg.devStarting();
  // @ts-expect-error Failed state must retain the producer origin before teardown.
  reg.devBootFailed('boot failed');
  reg.addNode('node-child', [3000], 'scope-node', {
    origin: {
      kind: 'pty',
      // @ts-expect-error A raw PTY pair is not preview correlation authority.
      ptySid: 'terminal-raw',
      ptyRid: 'run-raw',
    },
  });
}

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
    reg.addNode('s1', [3000], 'scope-node-1', { origin: HOST_PREVIEW_ORIGIN });
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
    reg.setDevServer(5174, 'scope-dev-1', { origin: HOST_PREVIEW_ORIGIN });
    reg.setDevServer(5175, 'scope-dev-2', { origin: HOST_PREVIEW_ORIGIN });
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
    reg.setDevServer(5174, 'scope-dev', { origin: HOST_PREVIEW_ORIGIN });
    reg.setPreview(4173, 'scope-preview-1', HOST_PREVIEW_ORIGIN);
    reg.setPreview(4174, 'scope-preview-2', HOST_PREVIEW_ORIGIN);
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
    reg.addNode('s1', [3000], 'scope-node', { origin: HOST_PREVIEW_ORIGIN });
    sent.length = 0;
    reg.publish();
    expect(sent).toHaveLength(1);
    expect(previewFrames(sent)[0]!.ports).toHaveLength(1);
  });

  it('multiple node ports + dev-server coexist in order', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.setDevServer(5174, 'scope-dev', { origin: HOST_PREVIEW_ORIGIN });
    reg.addNode('s1', [3000], 'scope-node-1', { origin: HOST_PREVIEW_ORIGIN });
    reg.addNode('s2', [8080, 8081], 'scope-node-2', { origin: HOST_PREVIEW_ORIGIN });
    expect(
      previewFrames(sent)
        .at(-1)!
        .ports.map((p) => p.port),
    ).toEqual([5174, 3000, 8080, 8081]);
  });

  it('dedups a node port that collides with the dev-server port — dev wins (C3)', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.setDevServer(5174, 'scope-dev', { origin: HOST_PREVIEW_ORIGIN });
    // A `node server.js` that picked the SAME port (no PORT injection, ADR-0155 §4)
    // must NOT be double-listed: the SW routes one /preview/5174/, so two entries
    // would make the page wire two clobbering bridges whose teardown deletes the
    // shared route. The dev slot wins; the distinct node port stays.
    reg.addNode('s1', [5174, 4001], 'scope-node', { origin: HOST_PREVIEW_ORIGIN });
    const ports = previewFrames(sent).at(-1)!.ports;
    expect(ports.map((p) => p.port)).toEqual([5174, 4001]);
    expect(ports.find((p) => p.port === 5174)?.source).toBe('dev-server');
  });

  it('labels a bin entry by its labelBase', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.addNode('bin-1', [8080], 'scope-bin', {
      origin: HOST_PREVIEW_ORIGIN,
      labelBase: 'webpack-dev-server',
    });
    const ports = previewFrames(sent).at(-1)!.ports;
    expect(ports[0]?.label).toBe('webpack-dev-server :8080');
  });

  it('carries the launching PTY identity on every PTY-produced preview advertisement', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });

    reg.setDevServer(5174, 'scope-dev', { origin: ptyOrigin('terminal-dev', 'run-dev') });
    reg.setPreview(4173, 'scope-preview', ptyOrigin('terminal-preview', 'run-preview'));
    reg.addNode('node-child-1', [3000], 'scope-node', {
      origin: ptyOrigin('terminal-node', 'run-node'),
    });

    expect(
      previewFrames(sent)
        .at(-1)!
        .ports.map(({ source, ptySid, ptyRid }) => ({ source, ptySid, ptyRid })),
    ).toEqual([
      { source: 'dev-server', ptySid: 'terminal-dev', ptyRid: 'run-dev' },
      { source: 'preview', ptySid: 'terminal-preview', ptyRid: 'run-preview' },
      { source: 'node', ptySid: 'terminal-node', ptyRid: 'run-node' },
    ]);
  });

  it('requires every source to declare host or actor-admitted PTY origin', () => {
    expect(assertPreviewOriginContract).toBeTypeOf('function');
    expect(HOST_PREVIEW_ORIGIN).toEqual({ kind: 'host' });
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
    reg.addNode('bin-1', [8080], 'scope-1', {
      origin: ptyOrigin('term-1', 'run-1'),
      labelBase: 'webpack',
    });
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
    reg.addNode('node-1', [3000], 'scope-1', { origin: ptyOrigin('term-1', 'run-1') });
    reg.addNode('node-1', [], 'scope-1', { origin: ptyOrigin('term-1', 'run-1') });
    expect(devFrames(sent).at(-1)?.status).toBe('stopped');
  });

  it('no duplicate running frames while the primary is unchanged', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.addNode('node-1', [3000], 'scope-1', { origin: ptyOrigin('term-1', 'run-1') });
    const before = devFrames(sent).length;
    reg.addNode('node-2', [4000], 'scope-2', { origin: ptyOrigin('term-2', 'run-2') });
    expect(devFrames(sent)).toHaveLength(before);
  });

  it('primary handover: first server closes → running frame for the next port', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.addNode('node-1', [3000], 'scope-1', { origin: ptyOrigin('term-1', 'run-1') });
    reg.addNode('node-2', [4000], 'scope-2', { origin: ptyOrigin('term-2', 'run-2') });
    reg.removeBySid('node-1');
    expect(devFrames(sent).at(-1)).toMatchObject({ status: 'running', port: 4000, sid: 'term-2' });
  });

  it('controller path: devStarting → starting; setDevServer → running; devStopped → stopped', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    const origin = ptyOrigin('term-1', 'run-1');
    reg.devStarting(origin);
    expect(devFrames(sent).at(-1)).toEqual({
      type: 'pty:dev-server',
      status: 'starting',
      sid: 'term-1',
    });
    reg.setDevServer(5174, 'scope-dev', { origin });
    expect(devFrames(sent).at(-1)).toMatchObject({ status: 'running', port: 5174, sid: 'term-1' });
    reg.devStopped();
    expect(devFrames(sent).at(-1)).toMatchObject({ status: 'stopped', sid: 'term-1' });
  });

  it('devBootFailed → stopped frame with error', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    const origin = ptyOrigin('term-1', 'run-1');
    reg.devStarting(origin);
    reg.devBootFailed('boom', origin);
    expect(devFrames(sent).at(-1)).toEqual({
      type: 'pty:dev-server',
      status: 'stopped',
      sid: 'term-1',
      error: 'boom',
    });
  });

  it('devBootFailed removes an already-running dev slot before emitting the error', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    const origin = ptyOrigin('term-1', 'run-1');
    reg.setDevServer(5174, 'scope-dev', { origin });

    reg.devBootFailed('child crashed', origin);

    expect(devFrames(sent).at(-1)).toEqual({
      type: 'pty:dev-server',
      status: 'stopped',
      sid: 'term-1',
      error: 'child crashed',
    });
    expect(previewFrames(sent).at(-1)).toEqual({ type: 'pty:preview', ports: [] });
  });

  it('devBootFailed with ANOTHER server live keeps the derived running status (error still carried)', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.addNode('node-1', [3000], 'scope-1', { origin: ptyOrigin('term-1', 'run-1') });
    const failedOrigin = ptyOrigin('term-2', 'run-2');
    reg.devStarting(failedOrigin);
    reg.devBootFailed('boom', failedOrigin);
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
    reg.addNode('node-1', [3000], 'scope-1', { origin: ptyOrigin('term-1', 'run-1') });
    reg.devStarting(ptyOrigin('term-2', 'run-2'));
    expect(devFrames(sent).at(-1)?.status).toBe('running');
  });

  it('publishDev() re-emits the current derived frame (handshake)', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.addNode('node-1', [3000], 'scope-1', { origin: ptyOrigin('term-1', 'run-1') });
    sent.length = 0;
    reg.publishDev();
    expect(devFrames(sent).at(-1)).toMatchObject({ status: 'running', port: 3000 });
  });

  it('carries the owner-reported command cwd on derived running frames', () => {
    // The page records the reload-restore command from this frame — its session
    // cache is stale mid-run ('/'), so the OWNER cwd is the only honest source.
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    reg.addNode('bin-1', [8080], 'scope-1', {
      origin: ptyOrigin('term-1', 'run-1'),
      cwd: '/scratch',
    });
    expect(devFrames(sent).at(-1)).toMatchObject({ status: 'running', cwd: '/scratch' });
    reg.removeBySid('bin-1');
    reg.setDevServer(5174, 'scope-dev', {
      origin: ptyOrigin('term-2', 'run-2'),
      cwd: '/projects/p1',
    });
    expect(devFrames(sent).at(-1)).toMatchObject({ status: 'running', cwd: '/projects/p1' });
  });
});

describe('preview-registry teardown', () => {
  it('revokes both advertisements once and fences every late producer callback', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });
    const origin = ptyOrigin('term-1', 'run-1');
    reg.setDevServer(5174, 'scope-dev', { origin });
    reg.setPreview(4173, 'scope-preview', origin);
    reg.addNode('node-1', [3000], 'scope-node', { origin });
    reg.devStarting(origin);
    sent.length = 0;

    expect(reg.close()).toBeUndefined();
    expect(sent).toEqual([
      { type: 'pty:preview', ports: [] },
      { type: 'pty:dev-server', status: 'stopped' },
    ]);

    reg.setDevServer(5175, 'scope-late-dev', { origin });
    reg.clearDevServer();
    reg.setPreview(4174, 'scope-late-preview', origin);
    reg.clearPreview();
    reg.addNode('node-late', [4000], 'scope-late-node', { origin });
    reg.removeBySid('node-late');
    reg.devStarting(origin);
    reg.devStopped();
    reg.devBootFailed('late failure', origin);
    reg.publish();
    reg.publishDev();
    reg.close();

    expect(sent).toEqual([
      { type: 'pty:preview', ports: [] },
      { type: 'pty:dev-server', status: 'stopped' },
    ]);
  });

  it('publishes an explicit empty teardown snapshot when no producer registered', () => {
    const { send, sent } = frames();
    const reg = createPreviewRegistry({ send });

    reg.close();
    reg.close();

    expect(sent).toEqual([
      { type: 'pty:preview', ports: [] },
      { type: 'pty:dev-server', status: 'stopped' },
    ]);
  });
});
