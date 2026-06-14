import { expect, it } from 'vitest';
import { createEditorSync } from './editor-sync.ts';

it('writes entry and files through the runtime session', () => {
  const writes: Array<[string, string]> = [];
  const editor = createEditorSync({
    session: {
      entryPath: '/workspace/src/main.js',
      updateFile: (path, content) => writes.push([path, content]),
    },
  });

  editor.writeEntry('entry');
  editor.writeFile('/workspace/package.json', '{}');

  expect(writes).toEqual([
    ['/workspace/src/main.js', 'entry'],
    ['/workspace/package.json', '{}'],
  ]);
});

it('subscribes to worker snapshots when a callback is provided', () => {
  let subscribedPort = 0;
  let disposed = false;
  const editor = createEditorSync({
    session: {
      port: 5174,
      entryPath: '/workspace/src/main.js',
      updateFile: () => undefined,
    },
    onSnapshot: () => undefined,
    subscribeSnapshot: (port) => {
      subscribedPort = port;
      return () => {
        disposed = true;
      };
    },
  });

  expect(subscribedPort).toBe(5174);
  editor.dispose();
  editor.dispose();
  expect(disposed).toBe(true);
});

it('sends mkdir frames through the worker VFS write channel', () => {
  const frames: Array<[number, unknown]> = [];
  const editor = createEditorSync({
    session: {
      port: 5175,
      entryPath: '/workspace/src/main.js',
      updateFile: () => undefined,
    },
    sendVfsWrite: (port, frame) => frames.push([port, frame]),
  });

  editor.mkdir('/workspace/src/features', false);

  expect(frames).toEqual([
    [
      5175,
      {
        type: 'mkdir',
        path: '/workspace/src/features',
        recursive: false,
      },
    ],
  ]);
});

it('does not silently no-op mkdir when a session has no worker port', () => {
  const editor = createEditorSync({
    session: {
      entryPath: '/workspace/src/main.js',
      updateFile: () => undefined,
    },
  });

  expect(() => editor.mkdir('/workspace/src/features')).toThrow(
    'editor sync mkdir requires a session port',
  );
});
