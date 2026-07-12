import { describe, expect, it } from 'vitest';
import { Duplex } from './duplex.ts';
import { Transform } from './transform.ts';
import { Writable, type WriteChunk } from './writable.ts';

type ScalarSurface = 'Writable' | 'Duplex' | 'Transform';
type BatchSurface = ScalarSurface;
type ScalarTarget = Writable | Duplex | Transform;
type BatchTarget = ScalarTarget;
type WriteCallback = (error?: Error | null) => void;
type WriteHook = (chunk: unknown, encoding: string, callback: WriteCallback) => void;
type FinalHook = (callback: WriteCallback) => void;

const scalarSurfaces = ['Writable', 'Duplex', 'Transform'] as const;
const batchSurfaces = ['Writable', 'Duplex', 'Transform'] as const;
const destroyKinds = ['reason', 'clean'] as const;
const lateOutcomes = ['success', 'error'] as const;
const postTerminalKinds = ['natural', 'clean', 'reason'] as const;
const lateCompletionCases = scalarSurfaces.flatMap((surface) =>
  destroyKinds.flatMap((destroyKind) =>
    lateOutcomes.map((outcome) => ({ surface, destroyKind, outcome })),
  ),
);
const postTerminalEndCases = scalarSurfaces.flatMap((surface) =>
  postTerminalKinds.map((terminalKind) => ({ surface, terminalKind })),
);
const immediatePostDestroyEndCases = scalarSurfaces.flatMap((surface) =>
  destroyKinds.map((destroyKind) => ({ surface, destroyKind })),
);

function phase(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeScalarTarget(
  surface: ScalarSurface,
  highWaterMark: number,
  write: WriteHook,
  final?: FinalHook,
): ScalarTarget {
  if (surface === 'Writable') return new Writable({ highWaterMark, write, final });
  if (surface === 'Duplex') {
    return new Duplex({ highWaterMark, read(): void {}, write, final });
  }
  return new Transform({
    highWaterMark,
    transform(chunk, encoding, callback): void {
      write(chunk, encoding, callback);
    },
    ...(final === undefined
      ? {}
      : {
          flush(callback: WriteCallback): void {
            final(callback);
          },
        }),
  });
}

function makeBatchTarget(
  surface: BatchSurface,
  highWaterMark: number,
  events: string[],
  writev: (chunks: WriteChunk[], callback: WriteCallback) => void,
): BatchTarget {
  const options = {
    highWaterMark,
    write(_chunk: unknown, _encoding: string, callback: WriteCallback): void {
      events.push('unexpected-write');
      callback();
    },
    writev,
  };
  return surface === 'Writable'
    ? new Writable(options)
    : surface === 'Duplex'
      ? new Duplex({ ...options, read(): void {} })
      : new Transform(options);
}

function batchOwner(stream: BatchTarget): Writable {
  return stream instanceof Duplex ? stream.writableSide : stream;
}

describe('Writable completion boundary', () => {
  it.each(scalarSurfaces)('%s defers sync success callbacks through finish', async (surface) => {
    const events: string[] = [];
    const write: WriteHook = (chunk, _encoding, callback) => {
      events.push(
        `hook:${String(chunk)}:len=${stream.writableLength}:writing=${stream._writableState.writing}`,
      );
      callback();
      events.push(
        `hook-after:len=${stream.writableLength}:writing=${stream._writableState.writing}`,
      );
    };
    const final: FinalHook = (callback) => {
      events.push('final');
      callback();
      events.push('final-after');
    };
    const stream = makeScalarTarget(surface, 1, write, final);
    stream.on('prefinish', () => events.push('prefinish'));
    stream.on('finish', () => events.push('finish'));
    stream.on('close', () => events.push('close'));

    events.push('before');
    const returned = stream.write('x', () => events.push('write-cb'));
    events.push(
      `after-write:ret=${returned}:len=${stream.writableLength}:writing=${stream._writableState.writing}:need=${stream._writableState.needDrain}`,
    );
    stream.end(() => events.push('end-cb'));
    events.push('after-end');
    await phase();

    expect(events).toEqual([
      'before',
      'hook:x:len=1:writing=true',
      'hook-after:len=0:writing=false',
      'after-write:ret=true:len=0:writing=false:need=false',
      'final',
      'prefinish',
      'final-after',
      'after-end',
      'write-cb',
      'end-cb',
      'finish',
      ...(surface === 'Writable' ? ['close'] : []),
    ]);
    if (!stream.destroyed) stream.destroy();
  });

  it.each(scalarSurfaces)(
    '%s drains an async first write and sync queued write in Node order',
    async (surface) => {
      const events: string[] = [];
      let calls = 0;
      let release: WriteCallback | undefined;
      const write: WriteHook = (chunk, _encoding, callback) => {
        calls += 1;
        events.push(
          `hook:${String(chunk)}:len=${stream.writableLength}:writing=${stream._writableState.writing}`,
        );
        if (calls === 1) release = callback;
        else {
          callback();
          events.push(`hook-after:${String(chunk)}`);
        }
      };
      const stream = makeScalarTarget(surface, 2, write);
      stream.on('drain', () => {
        events.push(`drain:len=${stream.writableLength}:need=${stream._writableState.needDrain}`);
      });

      const first = stream.write('a', () => events.push('cb:a'));
      const second = stream.write('b', () => events.push('cb:b'));
      events.push(
        `returns:${first}:${second}:len=${stream.writableLength}:need=${stream._writableState.needDrain}`,
      );
      events.push('release-before');
      release?.();
      events.push(
        `release-after:len=${stream.writableLength}:need=${stream._writableState.needDrain}`,
      );
      await phase();

      expect(events).toEqual([
        'hook:a:len=1:writing=true',
        'returns:true:false:len=2:need=true',
        'release-before',
        'hook:b:len=1:writing=true',
        'hook-after:b',
        'drain:len=0:need=false',
        'cb:a',
        'release-after:len=0:need=false',
        'cb:b',
      ]);
      stream.destroy();
    },
  );

  it.each(scalarSurfaces)('%s defers a sync write error past write()', async (surface) => {
    const failure = new Error(`sync-${surface}`);
    const events: string[] = [];
    const write: WriteHook = (chunk, _encoding, callback) => {
      events.push(`hook:${String(chunk)}`);
      callback(failure);
      events.push('hook-after');
    };
    const stream = makeScalarTarget(surface, 1, write);
    stream.on('error', (error) => events.push(`error:${error === failure}`));
    stream.on('close', () => events.push('close'));

    events.push('before');
    const returned = stream.write('x', (error) => events.push(`cb:${error === failure}`));
    events.push(
      `after:ret=${returned}:len=${stream.writableLength}:writing=${stream._writableState.writing}:need=${stream._writableState.needDrain}`,
    );
    await phase();

    expect(events).toEqual([
      'before',
      'hook:x',
      'hook-after',
      'after:ret=false:len=0:writing=false:need=false',
      'cb:true',
      'error:true',
      'close',
    ]);
  });

  it.each(batchSurfaces)('%s defers sync _writev success past uncork()', async (surface) => {
    const events: string[] = [];
    const stream = makeBatchTarget(surface, 2, events, (chunks, callback) => {
      events.push(`writev:${chunks.map(({ chunk }) => String(chunk)).join('')}`);
      callback();
      events.push('writev-after');
    });
    stream.on('drain', () => {
      events.push(`drain:len=${stream.writableLength}:need=${stream._writableState.needDrain}`);
    });
    batchOwner(stream).cork();
    const first = stream.write('a', () => events.push('cb:a'));
    const second = stream.write('b', () => events.push('cb:b'));
    events.push(
      `returns:${first}:${second}:len=${stream.writableLength}:need=${stream._writableState.needDrain}`,
    );
    events.push('before-uncork');
    batchOwner(stream).uncork();
    events.push(
      `after-uncork:len=${stream.writableLength}:need=${stream._writableState.needDrain}`,
    );
    await phase();

    expect(events).toEqual([
      'returns:true:false:len=2:need=true',
      'before-uncork',
      'writev:ab',
      'writev-after',
      'after-uncork:len=0:need=true',
      'drain:len=0:need=false',
      'cb:a',
      'cb:b',
    ]);
    stream.destroy();
  });

  it.each(batchSurfaces)('%s defers sync _writev failure past uncork()', async (surface) => {
    const failure = new Error(`writev-${surface}`);
    const events: string[] = [];
    const stream = makeBatchTarget(surface, 2, events, (chunks, callback) => {
      events.push(`writev:${chunks.map(({ chunk }) => String(chunk)).join('')}`);
      callback(failure);
      events.push('writev-after');
    });
    stream.on('error', (error) => events.push(`error:${error === failure}`));
    stream.on('close', () => events.push('close'));
    batchOwner(stream).cork();
    const first = stream.write('a', (error) => events.push(`cb:a:${error === failure}`));
    const second = stream.write('b', (error) => events.push(`cb:b:${error === failure}`));
    events.push(
      `returns:${first}:${second}:len=${stream.writableLength}:need=${stream._writableState.needDrain}`,
    );
    events.push('before-uncork');
    batchOwner(stream).uncork();
    events.push(
      `after-uncork:len=${stream.writableLength}:need=${stream._writableState.needDrain}`,
    );
    await phase();

    expect(events).toEqual([
      'returns:true:false:len=2:need=true',
      'before-uncork',
      'writev:ab',
      'writev-after',
      'after-uncork:len=0:need=true',
      'cb:a:true',
      'cb:b:true',
      'error:true',
      'close',
    ]);
  });

  it.each(scalarSurfaces)(
    '%s publishes repeated end callbacks FIFO before finish',
    async (surface) => {
      const events: string[] = [];
      const stream = makeScalarTarget(
        surface,
        1,
        (_chunk, _encoding, callback) => callback(),
        (callback) => {
          events.push('final');
          callback();
          events.push('final-after');
        },
      );
      stream.on('prefinish', () => events.push('prefinish'));
      stream.on('finish', () => events.push('finish'));
      stream.on('close', () => events.push('close'));

      events.push('before');
      stream.end((error: Error | null | undefined) => events.push(`end1:${error === null}`));
      events.push('after-end1');
      stream.end((error: Error | null | undefined) => events.push(`end2:${error === null}`));
      events.push('after-end2');
      await phase();

      expect(events).toEqual([
        'before',
        'final',
        'prefinish',
        'final-after',
        'after-end1',
        'after-end2',
        'end1:true',
        'end2:true',
        'finish',
        ...(surface === 'Writable' ? ['close'] : []),
      ]);
      if (!stream.destroyed) stream.destroy();
    },
  );

  it.each(scalarSurfaces)(
    '%s suppresses final and settles immediate end after a sync write error',
    async (surface) => {
      const failure = new Error(`write-end-${surface}`);
      const events: string[] = [];
      const stream = makeScalarTarget(
        surface,
        2,
        (chunk, _encoding, callback) => {
          events.push(`hook:${String(chunk)}`);
          callback(failure);
          events.push('hook-after');
        },
        (callback) => {
          events.push('forbidden-final');
          callback();
        },
      );
      stream.on('prefinish', () => events.push('forbidden-prefinish'));
      stream.on('error', (error) => events.push(`error:${error === failure}`));
      stream.on('close', () => events.push('close'));

      events.push('before');
      const returned = stream.write('x', (error) => events.push(`write-cb:${error === failure}`));
      events.push(`after-write:${returned}`);
      stream.end((error: Error | null | undefined) => events.push(`end-cb:${error === failure}`));
      events.push('after-end');
      await phase();

      expect(events).toEqual([
        'before',
        'hook:x',
        'hook-after',
        'after-write:false',
        'after-end',
        'write-cb:true',
        'end-cb:true',
        'error:true',
        'close',
      ]);
    },
  );

  it.each(scalarSurfaces)(
    '%s settles an async write error and its queued successor on the release stack',
    async (surface) => {
      const failure = new Error(`queued-${surface}`);
      const events: string[] = [];
      let release: WriteCallback | undefined;
      const stream = makeScalarTarget(surface, 2, (chunk, _encoding, callback) => {
        events.push(`hook:${String(chunk)}`);
        release = callback;
      });
      stream.on('error', (error) => events.push(`error:${error === failure}`));
      stream.on('close', () => events.push('close'));

      const first = stream.write('a', (error) => events.push(`cb:a:${error === failure}`));
      const second = stream.write('b', (error) => events.push(`cb:b:${error === failure}`));
      events.push(`returns:${first}:${second}`);
      events.push('release-before');
      release?.(failure);
      events.push('release-after');
      await phase();

      expect(events).toEqual([
        'hook:a',
        'returns:true:false',
        'release-before',
        'cb:a:true',
        'cb:b:true',
        'release-after',
        'error:true',
        'close',
      ]);
    },
  );

  it.each(scalarSurfaces)('%s settles end after a sync final error and close', async (surface) => {
    const failure = new Error(`final-${surface}`);
    const events: string[] = [];
    const stream = makeScalarTarget(
      surface,
      1,
      (_chunk, _encoding, callback) => callback(),
      (callback) => {
        events.push('final');
        callback(failure);
        events.push('final-after');
      },
    );
    stream.on('prefinish', () => events.push('forbidden-prefinish'));
    stream.on('finish', () => events.push('forbidden-finish'));
    stream.on('error', (error) => events.push(`error:${error === failure}`));
    stream.on('close', () => events.push('close'));

    events.push('before');
    stream.end((error: Error | null | undefined) => events.push(`end-cb:${error === failure}`));
    events.push('after-end');
    await phase();

    expect(events).toEqual([
      'before',
      'final',
      'final-after',
      'after-end',
      'error:true',
      'close',
      'end-cb:true',
    ]);
  });

  it.each(scalarSurfaces)(
    '%s settles end on the release stack after an async final error',
    async (surface) => {
      const failure = new Error(`async-final-${surface}`);
      const events: string[] = [];
      let release: WriteCallback | undefined;
      const stream = makeScalarTarget(
        surface,
        1,
        (_chunk, _encoding, callback) => callback(),
        (callback) => {
          events.push('final');
          release = callback;
        },
      );
      stream.on('prefinish', () => events.push('forbidden-prefinish'));
      stream.on('finish', () => events.push('forbidden-finish'));
      stream.on('error', (error) => events.push(`error:${error === failure}`));
      stream.on('close', () => events.push('close'));

      events.push('before');
      stream.end((error: Error | null | undefined) => events.push(`end-cb:${error === failure}`));
      events.push('after-end');
      events.push('release-before');
      release?.(failure);
      events.push('release-after');
      await phase();

      expect(events).toEqual([
        'before',
        'final',
        'after-end',
        'release-before',
        'end-cb:true',
        'release-after',
        'error:true',
        'close',
      ]);
    },
  );

  it.each(scalarSurfaces)(
    '%s settles pending end before explicit destroy(error) events',
    async (surface) => {
      const failure = new Error(`destroy-${surface}`);
      const events: string[] = [];
      const stream = makeScalarTarget(
        surface,
        1,
        (_chunk, _encoding, callback) => callback(),
        (_callback) => events.push('final'),
      );
      stream.on('error', (error) => events.push(`error:${error === failure}`));
      stream.on('close', () => events.push('close'));

      stream.end((error: Error | null | undefined) => events.push(`end-cb:${error === failure}`));
      events.push('before-destroy');
      stream.destroy(failure);
      events.push('after-destroy');
      await phase();

      expect(events).toEqual([
        'final',
        'before-destroy',
        'after-destroy',
        'end-cb:true',
        'error:true',
        'close',
      ]);
    },
  );

  it.each(scalarSurfaces)(
    '%s settles pending end with ERR_STREAM_DESTROYED before clean destroy close',
    async (surface) => {
      const events: string[] = [];
      const stream = makeScalarTarget(
        surface,
        1,
        (_chunk, _encoding, callback) => callback(),
        (_callback) => events.push('final'),
      );
      stream.on('error', (error) =>
        events.push(`forbidden-error:${String((error as { code?: unknown }).code)}`),
      );
      stream.on('close', () => events.push('close'));

      stream.end((error: Error | null | undefined) =>
        events.push(`end-cb:${(error as (Error & { code?: string }) | undefined)?.code}`),
      );
      events.push('before-destroy');
      stream.destroy();
      events.push('after-destroy');
      await phase();

      expect(events).toEqual([
        'final',
        'before-destroy',
        'after-destroy',
        'end-cb:ERR_STREAM_DESTROYED',
        'close',
      ]);
    },
  );

  it.each(scalarSurfaces)(
    '%s lets finish-listener destroy replace natural close exactly once',
    async (surface) => {
      const failure = new Error(`finish-destroy-${surface}`);
      const events: string[] = [];
      const stream = makeScalarTarget(
        surface,
        1,
        (_chunk, _encoding, callback) => callback(),
        (callback) => {
          events.push('final');
          callback();
        },
      );
      stream.on('finish', () => {
        events.push('finish');
        stream.destroy(failure);
      });
      stream.on('error', (error) => events.push(`error:${error === failure}`));
      stream.on('close', () => events.push('close'));

      stream.end((error: Error | null | undefined) => events.push(`end-cb:${error === null}`));
      await phase();

      expect(events).toEqual(['final', 'end-cb:true', 'finish', 'error:true', 'close']);
    },
  );

  it.each(scalarSurfaces)(
    '%s lets end-callback destroy replace natural close exactly once',
    async (surface) => {
      const failure = new Error(`end-destroy-${surface}`);
      const events: string[] = [];
      const stream = makeScalarTarget(
        surface,
        1,
        (_chunk, _encoding, callback) => callback(),
        (callback) => {
          events.push('final');
          callback();
        },
      );
      stream.on('finish', () => events.push('finish'));
      stream.on('error', (error) => events.push(`error:${error === failure}`));
      stream.on('close', () => events.push('close'));

      stream.end((error: Error | null | undefined) => {
        events.push(`end-cb:${error === null}`);
        stream.destroy(failure);
      });
      await phase();

      expect(events).toEqual(['final', 'end-cb:true', 'finish', 'error:true', 'close']);
    },
  );

  it.each(lateCompletionCases)(
    '$surface ignores late final $outcome after $destroyKind destroy',
    async ({ surface, destroyKind, outcome }) => {
      const destroyError = new Error(`destroy-${surface}`);
      const lateError = new Error(`late-final-${surface}`);
      const events: string[] = [];
      let release: WriteCallback | undefined;
      const stream = makeScalarTarget(
        surface,
        1,
        (_chunk, _encoding, callback) => callback(),
        (callback) => {
          events.push('final');
          release = callback;
        },
      );
      stream.on('prefinish', () => events.push('forbidden-prefinish'));
      stream.on('finish', () => events.push('forbidden-finish'));
      stream.on('error', (error) => events.push(`error:${error === destroyError}`));
      stream.on('close', () => events.push('close'));
      stream.end((error: Error | null | undefined) => {
        const code = (error as (Error & { code?: string }) | undefined)?.code;
        events.push(
          destroyKind === 'reason' ? `end-cb:${error === destroyError}` : `end-cb:${code}`,
        );
      });
      stream.destroy(destroyKind === 'reason' ? destroyError : undefined);
      await phase();

      events.push('before-late');
      release?.(outcome === 'error' ? lateError : undefined);
      events.push('after-late');
      await phase();
      const terminalError = stream._writableState.errored;
      events.push(
        `state:${terminalError === destroyError}:${terminalError === null}:${terminalError === lateError}`,
      );

      expect(events).toEqual([
        'final',
        ...(destroyKind === 'reason'
          ? ['end-cb:true', 'error:true', 'close']
          : ['end-cb:ERR_STREAM_DESTROYED', 'close']),
        'before-late',
        'after-late',
        ...(destroyKind === 'reason' ? ['state:true:false:false'] : ['state:false:true:false']),
      ]);
    },
  );

  it.each(lateCompletionCases)(
    '$surface publishes late scalar $outcome after $destroyKind destroy without reopening',
    async ({ surface, destroyKind, outcome }) => {
      const destroyError = new Error(`destroy-write-${surface}`);
      const lateError = new Error(`late-write-${surface}`);
      const events: string[] = [];
      let release: WriteCallback | undefined;
      const stream = makeScalarTarget(surface, 1, (_chunk, _encoding, callback) => {
        events.push('write');
        release = callback;
      });
      stream.on('error', (error) => events.push(`error:${error === destroyError}`));
      stream.on('close', () => events.push('close'));
      stream.write('x', (error) =>
        events.push(`write-cb:${error === null}:${error === lateError}:${error === destroyError}`),
      );
      stream.destroy(destroyKind === 'reason' ? destroyError : undefined);
      await phase();

      events.push('before-late');
      release?.(outcome === 'error' ? lateError : undefined);
      events.push('after-late');
      await phase();
      const terminalError = stream._writableState.errored;
      events.push(
        `state:${terminalError === destroyError}:${terminalError === null}:${terminalError === lateError}`,
      );

      expect(events).toEqual([
        'write',
        ...(destroyKind === 'reason' ? ['error:true', 'close'] : ['close']),
        'before-late',
        ...(outcome === 'success' ? ['write-cb:true:false:false'] : ['write-cb:false:true:false']),
        'after-late',
        ...(destroyKind === 'reason'
          ? ['state:true:false:false']
          : outcome === 'success'
            ? ['state:false:true:false']
            : ['state:false:false:true']),
      ]);
    },
  );

  it.each(lateCompletionCases)(
    '$surface publishes late batch $outcome after $destroyKind destroy without reopening',
    async ({ surface, destroyKind, outcome }) => {
      const destroyError = new Error(`destroy-writev-${surface}`);
      const lateError = new Error(`late-writev-${surface}`);
      const events: string[] = [];
      let release: WriteCallback | undefined;
      const stream = makeBatchTarget(surface, 8, events, (chunks, callback) => {
        events.push(`writev:${chunks.map(({ chunk }) => String(chunk)).join('')}`);
        release = callback;
      });
      stream.on('error', (error) => events.push(`error:${error === destroyError}`));
      stream.on('close', () => events.push('close'));
      const owner = batchOwner(stream);
      owner.cork();
      for (const chunk of ['a', 'b']) {
        stream.write(chunk, (error) =>
          events.push(
            `${chunk}:${error === null}:${error === lateError}:${error === destroyError}`,
          ),
        );
      }
      owner.uncork();
      stream.destroy(destroyKind === 'reason' ? destroyError : undefined);
      await phase();

      events.push('before-late');
      release?.(outcome === 'error' ? lateError : undefined);
      events.push('after-late');
      await phase();
      const terminalError = stream._writableState.errored;
      events.push(
        `state:${terminalError === destroyError}:${terminalError === null}:${terminalError === lateError}`,
      );

      expect(events).toEqual([
        'writev:ab',
        ...(destroyKind === 'reason' ? ['error:true', 'close'] : ['close']),
        'before-late',
        ...(outcome === 'success'
          ? ['a:true:false:false', 'b:true:false:false']
          : ['a:false:true:false', 'b:false:true:false']),
        'after-late',
        ...(destroyKind === 'reason'
          ? ['state:true:false:false']
          : outcome === 'success'
            ? ['state:false:true:false']
            : ['state:false:false:true']),
      ]);
    },
  );

  it.each(postTerminalEndCases)(
    '$surface applies Node late-end semantics after $terminalKind terminal state',
    async ({ surface, terminalKind }) => {
      const destroyError = new Error(`terminal-${surface}`);
      const events: string[] = [];
      let calls = 0;
      const stream = makeScalarTarget(surface, 1, (_chunk, _encoding, callback) => callback());
      stream.on('error', () => events.push('error'));
      stream.on('close', () => events.push('close'));
      if (terminalKind === 'natural') stream.end();
      else stream.destroy(terminalKind === 'reason' ? destroyError : undefined);
      await phase();

      events.push('before-late-end');
      stream.end((error: Error | null | undefined) => {
        calls += 1;
        events.push(`late-end:${(error as (Error & { code?: string }) | undefined)?.code}`);
      });
      await phase();
      await phase();
      events.push(`after-late-end:${calls}`);

      expect(events).toEqual([
        ...(terminalKind === 'natural'
          ? surface === 'Writable'
            ? ['close']
            : []
          : terminalKind === 'reason'
            ? ['error', 'close']
            : ['close']),
        'before-late-end',
        ...(terminalKind === 'natural'
          ? ['late-end:ERR_STREAM_ALREADY_FINISHED']
          : terminalKind === 'reason'
            ? ['late-end:ERR_STREAM_DESTROYED']
            : []),
        `after-late-end:${terminalKind === 'clean' ? 0 : 1}`,
      ]);
      if (!stream.destroyed) stream.destroy();
    },
  );

  it.each(immediatePostDestroyEndCases)(
    '$surface applies Node end semantics after $destroyKind destroy starts',
    async ({ surface, destroyKind }) => {
      const destroyError = new Error(`immediate-${surface}`);
      const events: string[] = [];
      let calls = 0;
      const stream = makeScalarTarget(surface, 1, (_chunk, _encoding, callback) => callback());
      stream.on('error', () => events.push('error'));
      stream.on('close', () => events.push('close'));
      stream.destroy(destroyKind === 'reason' ? destroyError : undefined);
      stream.end((error: Error | null | undefined) => {
        calls += 1;
        events.push(`end-cb:${(error as (Error & { code?: string }) | undefined)?.code}`);
      });
      events.push('after-end');
      await phase();
      await phase();
      events.push(`calls:${calls}`);

      expect(events).toEqual([
        'after-end',
        ...(destroyKind === 'reason'
          ? ['error', 'close', 'end-cb:ERR_STREAM_DESTROYED']
          : ['close']),
        `calls:${destroyKind === 'reason' ? 1 : 0}`,
      ]);
    },
  );

  it.each(batchSurfaces)(
    '%s settles an async _writev error and writes queued behind the batch on the release stack',
    async (surface) => {
      const failure = new Error(`writev-behind-${surface}`);
      const events: string[] = [];
      let release: WriteCallback | undefined;
      const stream = makeBatchTarget(surface, 8, events, (chunks, callback) => {
        events.push(`writev:${chunks.map(({ chunk }) => String(chunk)).join('')}`);
        release = callback;
      });
      stream.on('error', (error) => events.push(`error:${error === failure}`));
      stream.on('close', () => events.push('close'));
      const owner = batchOwner(stream);
      owner.cork();
      stream.write('a', (error) => events.push(`cb:a:${error === failure}`));
      stream.write('b', (error) => events.push(`cb:b:${error === failure}`));
      owner.uncork();
      events.push(
        `after-uncork:${stream._writableState.writing}:${stream.writableLength}:release=${release !== undefined}`,
      );
      const third = stream.write('c', (error) => events.push(`cb:c:${error === failure}`));
      const fourth = stream.write('d', (error) => events.push(`cb:d:${error === failure}`));
      events.push(`queued:${third}:${fourth}`);
      events.push('release-before');
      release?.(failure);
      events.push('release-after');
      await phase();

      expect(events).toEqual([
        'writev:ab',
        'after-uncork:true:2:release=true',
        'queued:true:true',
        'release-before',
        'cb:a:true',
        'cb:b:true',
        'cb:c:true',
        'cb:d:true',
        'release-after',
        'error:true',
        'close',
      ]);
    },
  );

  it.each(scalarSurfaces)(
    '%s passes null to end callback after async final success',
    async (surface) => {
      const events: string[] = [];
      let release: WriteCallback | undefined;
      const stream = makeScalarTarget(
        surface,
        1,
        (_chunk, _encoding, callback) => callback(),
        (callback) => {
          events.push('final');
          release = callback;
        },
      );
      stream.on('prefinish', () => events.push('prefinish'));
      stream.on('finish', () => events.push('finish'));
      stream.on('close', () => events.push('close'));

      events.push('before');
      stream.end((error: Error | null | undefined) => events.push(`end-cb:${error === null}`));
      events.push('after-end');
      release?.();
      events.push('after-release');
      await phase();

      expect(events).toEqual([
        'before',
        'final',
        'after-end',
        'prefinish',
        'after-release',
        'end-cb:true',
        'finish',
        ...(surface === 'Writable' ? ['close'] : []),
      ]);
      if (!stream.destroyed) stream.destroy();
    },
  );

  it('marks a naturally closed Writable destroyed and closed after finish', async () => {
    const events: string[] = [];
    const stream = new Writable();
    const terminal = stream as Writable & { readonly closed?: boolean };
    stream.on('finish', () => events.push(`finish:${stream.destroyed}:${terminal.closed}`));
    stream.on('close', () => events.push(`close:${stream.destroyed}:${terminal.closed}`));

    stream.end((error: Error | null | undefined) =>
      events.push(`end:${error === null}:${stream.destroyed}:${terminal.closed}`),
    );
    await phase();

    expect(events).toEqual(['end:true:false:false', 'finish:false:false', 'close:true:true']);
    expect(stream.destroyed).toBe(true);
    expect(terminal.closed).toBe(true);
  });
});
