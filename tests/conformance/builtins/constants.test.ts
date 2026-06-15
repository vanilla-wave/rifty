import { describe, expect, it } from 'vitest';
import '../../../packages/runtime-js/src/builtins/index.ts';
import { loadBuiltin } from '../../../packages/io/src/builtin-registry.ts';
import { NotImplementedError } from '../../../packages/io/src/errors.ts';
import cryptoModule from '../../../packages/runtime-js/src/builtins/crypto.ts';
import { constants as fsConstants } from '../../../packages/runtime-js/src/builtins/fs.ts';
import { constants as osConstants } from '../../../packages/runtime-js/src/builtins/os.ts';

function nodeConstants(): Record<string, unknown> {
  const constants = loadBuiltin('node:constants');
  if (!constants) throw new Error('node:constants builtin not registered');
  return constants;
}

describe('node:constants', () => {
  it('flattens fs, os, and crypto constants instead of exporting an empty placeholder', () => {
    const constants = nodeConstants();

    expect(constants.O_RDONLY).toBe(fsConstants.O_RDONLY);
    expect(constants.COPYFILE_EXCL).toBe(fsConstants.COPYFILE_EXCL);
    expect(constants.SIGTERM).toBe(osConstants.signals.SIGTERM);
    expect(constants.ENOENT).toBe(osConstants.errno.ENOENT);
    expect(constants.PRIORITY_HIGHEST).toBe(osConstants.priority.PRIORITY_HIGHEST);
    expect(constants.RTLD_NOW).toBe(osConstants.dlopen.RTLD_NOW);
    expect(constants.RSA_PKCS1_PADDING).toBe(cryptoModule.constants.RSA_PKCS1_PADDING);
    expect(constants.defaultCoreCipherList).toBe(cryptoModule.constants.defaultCoreCipherList);
  });

  it('keeps unsupported constants loud instead of silently returning undefined', () => {
    expect(() => nodeConstants().O_SYNC).toThrow(NotImplementedError);
    expect(() => nodeConstants().O_SYNC).toThrow('constants.O_SYNC');
  });
});
