import { describe, expect, it } from 'vitest';
import { constants } from '../../../packages/runtime-js/src/builtins/os.ts';

describe('node:os constants', () => {
  it('exposes scoped rifty ABI signal and errno integers', () => {
    expect(constants.signals).toMatchObject({
      SIGHUP: 1,
      SIGINT: 2,
      SIGTERM: 15,
    });
    expect(constants.errno).toMatchObject({
      ENOENT: 2,
      EEXIST: 17,
      EINVAL: 22,
    });
    expect(constants.priority).toEqual({});
  });
});
