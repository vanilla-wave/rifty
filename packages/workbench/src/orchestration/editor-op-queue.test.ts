import { describe, expect, it, vi } from 'vitest';

import { createEditorOpQueue } from './editor-op-queue.ts';

describe('editor op queue', () => {
  it('flushes queued editor ops for the matching context', () => {
    const queue = createEditorOpQueue<{ openFile: (path: string) => void }>();
    const api = { openFile: vi.fn() };

    queue.runOrQueue(undefined, true, 'root:a', (editor) => editor.openFile('/a/readme.md'));
    queue.flush(api, 'root:a');

    expect(api.openFile).toHaveBeenCalledWith('/a/readme.md');
    expect(queue.size()).toBe(0);
  });

  it('drops queued editor ops when the editor context changes before registerApi', () => {
    const queue = createEditorOpQueue<{ openFile: (path: string) => void }>();
    const api = { openFile: vi.fn() };

    queue.runOrQueue(undefined, true, 'root:a', (editor) => editor.openFile('/a/readme.md'));
    queue.discardStale(true, 'root:b');
    queue.flush(api, 'root:b');

    expect(api.openFile).not.toHaveBeenCalled();
    expect(queue.size()).toBe(0);
  });

  it('clears pending editor ops when the editor context is no longer ready', () => {
    const queue = createEditorOpQueue<{ openFile: (path: string) => void }>();
    const api = { openFile: vi.fn() };

    queue.runOrQueue(undefined, true, 'root:a', (editor) => editor.openFile('/a/readme.md'));
    queue.discardStale(false, 'root:a');
    queue.flush(api, 'root:a');

    expect(api.openFile).not.toHaveBeenCalled();
  });

  it('runs immediately when an editor api is already registered', () => {
    const queue = createEditorOpQueue<{ openFile: (path: string) => void }>();
    const api = { openFile: vi.fn() };

    queue.runOrQueue(api, true, 'root:a', (editor) => editor.openFile('/a/readme.md'));

    expect(api.openFile).toHaveBeenCalledWith('/a/readme.md');
    expect(queue.size()).toBe(0);
  });
});
