import { describe, expect, it } from 'vitest';
import {
  type PreviewPortEntry,
  type PtyFrame,
  isOwnerToPage,
  isPageToOwner,
} from './pty-protocol.ts';

describe('pty-protocol', () => {
  it('classifies page→owner frames', () => {
    const f: PtyFrame = {
      type: 'pty:exec',
      sid: 's1',
      rid: 'r1',
      line: 'ls',
      cols: 80,
      rows: 24,
      isTTY: true,
    };
    expect(isPageToOwner(f)).toBe(true);
    expect(isOwnerToPage(f)).toBe(false);
  });
  it('classifies owner→page frames', () => {
    const f: PtyFrame = {
      type: 'pty:exit',
      sid: 's1',
      rid: 'r1',
      code: 0,
      exit: { code: 0, signal: null },
      cwd: '/',
      env: {},
    };
    expect(isOwnerToPage(f)).toBe(true);
    expect(isPageToOwner(f)).toBe(false);
  });
  it('classifies owner-authoritative run admission as owner→page', () => {
    const admitted: PtyFrame = {
      type: 'pty:run-ready',
      sid: 's1',
      rid: 'r1',
    };

    expect(isOwnerToPage(admitted)).toBe(true);
    expect(isPageToOwner(admitted)).toBe(false);
  });
  it('chunk frames carry Uint8Array data + monotonic seq shape', () => {
    const f: PtyFrame = {
      type: 'pty:chunk',
      sid: 's',
      rid: 'r',
      stream: 'stdout',
      seq: 0,
      data: new Uint8Array([1]),
    };
    expect(f.data).toBeInstanceOf(Uint8Array);
    expect(isOwnerToPage(f)).toBe(true);
  });
  it('routes pty:dev-server as owner→page', () => {
    const f: PtyFrame = {
      type: 'pty:dev-server',
      status: 'running',
      sid: 'terminal-1',
      port: 5174,
      url: '/preview/5174/',
    };
    expect(isOwnerToPage(f)).toBe(true);
    expect(isPageToOwner(f)).toBe(false);
  });
  it('routes pty:dev-server-req as page→owner', () => {
    const f: PtyFrame = { type: 'pty:dev-server-req' };
    expect(isPageToOwner(f)).toBe(true);
    expect(isOwnerToPage(f)).toBe(false);
  });
  it('routes pty:dev-config as page→owner', () => {
    const f: PtyFrame = {
      type: 'pty:dev-config',
      id: 'dc1',
      templateId: 'express-sqlite',
      slug: 'fullstack',
      setup: 'from-scratch',
    };
    expect(isPageToOwner(f)).toBe(true);
    expect(isOwnerToPage(f)).toBe(false);
  });
  it('routes pty:dev-config-ready as owner→page', () => {
    const f: PtyFrame = { type: 'pty:dev-config-ready', id: 'dc1' };
    expect(isOwnerToPage(f)).toBe(true);
    expect(isPageToOwner(f)).toBe(false);
  });
  it('classifies live resize and its owner acknowledgement', () => {
    const resize = {
      type: 'pty:resize',
      sid: 's1',
      rid: 'r1',
      opId: 'op1',
      cols: 120,
      rows: 40,
    } as unknown as PtyFrame;
    const ack = {
      type: 'pty:resize-ack',
      sid: 's1',
      rid: 'r1',
      opId: 'op1',
      ok: true,
    } as unknown as PtyFrame;

    expect(isPageToOwner(resize)).toBe(true);
    expect(isOwnerToPage(resize)).toBe(false);
    expect(isOwnerToPage(ack)).toBe(true);
    expect(isPageToOwner(ack)).toBe(false);
  });

  it('classifies acknowledged stdin/EOF and per-session close operations', () => {
    const stdin = {
      type: 'pty:stdin',
      sid: 's1',
      rid: 'r1',
      opId: 'op1',
      data: new Uint8Array([1]),
    } as unknown as PtyFrame;
    const eof = {
      type: 'pty:stdin-eof',
      sid: 's1',
      rid: 'r1',
      opId: 'op2',
    } as unknown as PtyFrame;
    const close = { type: 'pty:close', sid: 's1', opId: 'op3' } as unknown as PtyFrame;
    const stdinAck = {
      type: 'pty:stdin-ack',
      sid: 's1',
      rid: 'r1',
      opId: 'op1',
      ok: true,
    } as unknown as PtyFrame;
    const closeAck = {
      type: 'pty:close-ack',
      sid: 's1',
      opId: 'op3',
      ok: true,
    } as unknown as PtyFrame;

    expect([stdin, eof, close].every(isPageToOwner)).toBe(true);
    expect([stdinAck, closeAck].every(isOwnerToPage)).toBe(true);
  });

  it('keeps idle session resize distinct from mandatory-rid live resize', () => {
    const idle: PtyFrame = {
      type: 'pty:session-resize',
      sid: 's1',
      opId: 'session-resize-1',
      cols: 100,
      rows: 30,
    };
    const idleAck: PtyFrame = {
      type: 'pty:session-resize-ack',
      sid: 's1',
      opId: 'session-resize-1',
      ok: true,
    };
    const live: PtyFrame = {
      type: 'pty:resize',
      sid: 's1',
      rid: 'r1',
      opId: 'resize-1',
      cols: 100,
      rows: 30,
    };

    expect(isPageToOwner(idle)).toBe(true);
    expect(isOwnerToPage(idleAck)).toBe(true);
    expect(live).toMatchObject({ type: 'pty:resize', rid: 'r1' });
  });
});

describe('pty:preview frames', () => {
  it('requires PTY session and run identity together or neither', () => {
    const uncorrelated = {
      port: 3000,
      url: '/preview/3000/',
      label: 'host source',
      source: 'node',
      sid: 'host-1',
    } satisfies PreviewPortEntry;
    const correlated = {
      ...uncorrelated,
      sid: 'node-1',
      ptySid: 'terminal-1',
      ptyRid: 'run-1',
    } satisfies PreviewPortEntry;

    // @ts-expect-error PTY correlation cannot lose the admitted run id.
    const missingRid: PreviewPortEntry = { ...correlated, ptyRid: undefined };
    // @ts-expect-error PTY correlation cannot invent a run without its session.
    const missingSid: PreviewPortEntry = { ...correlated, ptySid: undefined };

    expect([uncorrelated, correlated]).toHaveLength(2);
    expect([missingRid, missingSid]).toHaveLength(2);
  });

  it('classifies pty:preview as owner→page', () => {
    const f: PtyFrame = {
      type: 'pty:preview',
      ports: [
        {
          port: 3000,
          url: '/preview/3000/',
          label: 'server.js',
          source: 'node',
          sid: 'node-1',
          ptySid: 'terminal-1',
          ptyRid: 'run-1',
        },
      ],
    };
    expect(isOwnerToPage(f)).toBe(true);
    expect(isPageToOwner(f)).toBe(false);
    expect(f.ports[0]?.ptySid).toBe('terminal-1');
    expect(f.ports[0]?.ptyRid).toBe('run-1');
  });
  it('classifies pty:preview-req as page→owner', () => {
    const f: PtyFrame = { type: 'pty:preview-req' };
    expect(isPageToOwner(f)).toBe(true);
    expect(isOwnerToPage(f)).toBe(false);
  });
});
