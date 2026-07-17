import { describe, expect, it, vi } from 'vitest';
import { savePlaygroundSession } from './playground-save.ts';

function deferred(): {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('Playground user save coordination', () => {
  it('publishes Saved only after editor admission and owner storage settle in order', async () => {
    const durability = deferred();
    const events: string[] = [];
    const saving = savePlaygroundSession({
      flushPendingEditorWrites: async () => {
        events.push('editor');
      },
      flushOwnerDurability: async () => {
        events.push('durability');
        await durability.promise;
      },
      isCurrent: () => true,
      reportSaved: () => events.push('Saved'),
      reportFailure: (error) => events.push(`failed:${String(error)}`),
    });

    await vi.waitFor(() => expect(events).toEqual(['editor', 'durability']));
    expect(events).not.toContain('Saved');
    durability.resolve();
    await saving;

    expect(events).toEqual(['editor', 'durability', 'Saved']);
  });

  it('reports a durability failure loudly and never publishes Saved', async () => {
    const failure = new Error('OPFS quota exceeded');
    const reportSaved = vi.fn();
    const reportFailure = vi.fn();

    await savePlaygroundSession({
      flushPendingEditorWrites: async () => {},
      flushOwnerDurability: async () => {
        throw failure;
      },
      isCurrent: () => true,
      reportSaved,
      reportFailure,
    });

    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledWith(failure);
    expect(reportSaved).not.toHaveBeenCalled();
  });

  // Fault class: provenance-lie. A completion belongs to the project captured
  // at admission and cannot publish status under its successor.
  it.each(['success', 'failure'] as const)(
    'suppresses stale %s reporting after the active project switches during durability',
    async (outcome) => {
      const durability = deferred();
      const reportSaved = vi.fn();
      const reportFailure = vi.fn();
      const durabilityStarted = vi.fn();
      let current = true;
      const options = {
        flushPendingEditorWrites: async () => {},
        flushOwnerDurability: () => {
          durabilityStarted();
          return durability.promise;
        },
        isCurrent: () => current,
        reportSaved,
        reportFailure,
      };
      const saving = savePlaygroundSession(options);
      await vi.waitFor(() => expect(durabilityStarted).toHaveBeenCalledTimes(1));

      current = false;
      if (outcome === 'success') durability.resolve();
      else durability.reject(new Error('old project durability failed'));
      await saving;

      expect(reportSaved).not.toHaveBeenCalled();
      expect(reportFailure).not.toHaveBeenCalled();
    },
  );
});
