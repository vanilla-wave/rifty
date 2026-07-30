import { afterEach, describe, expect, it } from 'vitest';
import { nodeRunnerFor, runInNode } from './run-in-node.ts';

const nativePlatform = process.platform;

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: nativePlatform });
});

describe('runInNode', () => {
  it.each([
    {
      platform: 'linux',
      args: [
        '-q',
        '-e',
        '-c',
        `stty cols 80 rows 24 && exec '${process.execPath}' '/tmp/rifty parity/entry.js'`,
        '/dev/null',
      ],
    },
    {
      platform: 'darwin',
      args: [
        '-q',
        '/dev/null',
        '/bin/sh',
        '-c',
        `stty cols 80 rows 24 && exec '${process.execPath}' '/tmp/rifty parity/entry.js'`,
      ],
    },
    {
      platform: 'freebsd',
      args: [
        '-q',
        '/dev/null',
        '/bin/sh',
        '-c',
        `stty cols 80 rows 24 && exec '${process.execPath}' '/tmp/rifty parity/entry.js'`,
      ],
    },
    {
      platform: 'netbsd',
      args: [
        '-q',
        '-e',
        '-c',
        `stty cols 80 rows 24 && exec '${process.execPath}' '/tmp/rifty parity/entry.js'`,
        '/dev/null',
      ],
    },
    {
      platform: 'openbsd',
      args: [
        '-c',
        `stty cols 80 rows 24 && exec '${process.execPath}' '/tmp/rifty parity/entry.js'`,
        '/dev/null',
      ],
    },
  ] satisfies ReadonlyArray<{ platform: NodeJS.Platform; args: readonly string[] }>)(
    'sets the initial tty grid before Node with the $platform script dialect',
    ({ platform, args }) => {
      Object.defineProperty(process, 'platform', { value: platform });

      expect(nodeRunnerFor({ kind: 'tty-resize', code: '' }, '/tmp/rifty parity/entry.js')).toEqual(
        ['script', args],
      );
    },
  );

  it('terminates a real native oracle that exceeds the per-case timeout', async () => {
    await expect(
      runInNode(
        {
          code: 'setTimeout(() => process.exit(0), 500);',
        },
        { timeoutMs: 50 },
      ),
    ).rejects.toThrow('Node parity case timed out after 50ms');
  });
});
