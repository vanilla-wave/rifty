import { Writable } from '@riftydev/io';
import { describe, expect, it } from 'vitest';
import { WorkerStdio } from './worker_threads-stdio.ts';

describe('Worker stdio construction rollback', () => {
  it.each(['missing stderr', 'throwing stderr getter'])(
    '%s leaves the first pipe unattached',
    (fault) => {
      const stdout = new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      });
      const counts = () => ['drain', 'error', 'close'].map((event) => stdout.listenerCount(event));
      const before = counts();
      const owner = {
        stdout,
        get stderr() {
          if (fault === 'throwing stderr getter') throw new Error('stderr getter');
          return undefined;
        },
      };
      expect(() => new WorkerStdio(owner, { stdout: false, stderr: false })).toThrow();
      expect(counts()).toEqual(before);
      expect(stdout.getMaxListeners()).toBe(10);
    },
  );
});
