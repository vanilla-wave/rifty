import { describe, expect, it } from 'vitest';
import {
  inspectPageToPlaygroundOwnerMessage,
  inspectPlaygroundOwnerToPageMessage,
} from './playground-owner-protocol.ts';
import { inspectPlaygroundRetainedScratchRecords } from './playground-project-catalog.ts';

const urlContext = {
  apiBaseUrl: 'https://host.test/app/',
  clientUrl: 'https://host.test/app/index.html',
};

describe('Retained Scratch catalog transport', () => {
  it('admits owner-level list/export commands without project identity', () => {
    for (const command of [
      { kind: 'list-retained-scratch' },
      { kind: 'export-retained-scratch', id: 'retained-A-12' },
    ]) {
      const message = { type: 'workbench:playground-catalog', opId: 'recovery-1', command };
      expect(inspectPageToPlaygroundOwnerMessage(message, urlContext)).toEqual(message);
    }
    for (const id of ['', '../scratch', '/scratch', 'a/b', 'a\\b', 'a\0b', 'a_b']) {
      expect(() =>
        inspectPageToPlaygroundOwnerMessage(
          {
            type: 'workbench:playground-catalog',
            opId: 'recovery-2',
            command: { kind: 'export-retained-scratch', id },
          },
          urlContext,
        ),
      ).toThrow(TypeError);
    }
  });

  it('owns immutable id records and refuses paths, duplicate ids and sparse collections', () => {
    const records = [{ id: 'retained-A' }];
    const message = inspectPlaygroundOwnerToPageMessage({
      type: 'workbench:playground-retained-scratch-listed',
      opId: 'recovery-3',
      records,
    });
    if (message.type !== 'workbench:playground-retained-scratch-listed') {
      throw new Error('Expected retained Scratch listing');
    }
    records[0]!.id = 'caller-mutated';
    expect(message.records).toEqual([{ id: 'retained-A' }]);
    expect(Object.isFrozen(message.records)).toBe(true);
    expect(Object.isFrozen(message.records[0])).toBe(true);
    for (const invalid of [
      [{ id: 'same' }, { id: 'same' }],
      [{ id: 'one', root: '/private' }],
      Array(1),
    ]) {
      expect(() => inspectPlaygroundRetainedScratchRecords(invalid)).toThrow(TypeError);
    }
  });

  it('rejects accessor records without executing their code', () => {
    let accessed = false;
    const record = Object.defineProperty({}, 'id', {
      enumerable: true,
      get() {
        accessed = true;
        return 'retained-A';
      },
    });
    expect(() => inspectPlaygroundRetainedScratchRecords([record])).toThrow(TypeError);
    expect(accessed).toBe(false);
  });

  it('carries recovery JSON beyond a single-file limit without parsing or truncation', () => {
    const archiveJson = JSON.stringify({ payload: 'x'.repeat(17 * 1024 * 1024 + 1) });
    const message = {
      type: 'workbench:playground-retained-scratch-exported',
      opId: 'recovery-4',
      archiveJson,
    };
    expect(inspectPlaygroundOwnerToPageMessage(message)).toEqual(message);
    expect(() => inspectPlaygroundOwnerToPageMessage({ ...message, archiveJson: {} })).toThrow(
      TypeError,
    );
    expect(() => inspectPlaygroundOwnerToPageMessage({ ...message, root: '/private' })).toThrow(
      TypeError,
    );
  });
});
