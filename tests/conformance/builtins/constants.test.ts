import { describe, expect, it } from 'vitest';
import '../../../packages/runtime-js/src/builtins/index.ts';
import { loadBuiltin } from '../../../packages/io/src/builtin-registry.ts';
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
    expect(constants.UV_UDP_REUSEADDR).toBe(osConstants.UV_UDP_REUSEADDR);
    expect(constants.RSA_PKCS1_PADDING).toBe(cryptoModule.constants.RSA_PKCS1_PADDING);
    expect(constants.defaultCoreCipherList).toBe(cryptoModule.constants.defaultCoreCipherList);
  });

  it('exposes formerly-unsupported constants as real Node numbers — gap moved to the syscall (ADR-0153)', () => {
    const constants = nodeConstants();
    // Reading a constant never throws: it is faithful static data. The unimplemented durability
    // BEHAVIOR of O_SYNC is a loud gap only when the flag reaches fs.open (see fs.test.ts).
    expect(constants.O_SYNC).toBe(fsConstants.O_SYNC);
    expect(constants.S_IFMT).toBe(fsConstants.S_IFMT);
    expect(constants.S_IFDIR).toBe(fsConstants.S_IFDIR);
    expect(constants.COPYFILE_FICLONE).toBe(fsConstants.COPYFILE_FICLONE);
    expect(constants.UV_DIRENT_FILE).toBe(fsConstants.UV_DIRENT_FILE);
  });

  it('returns undefined for keys Node does not define (plain-object shape, not a throw)', () => {
    expect(nodeConstants().TOTALLY_MADE_UP_KEY_XYZ).toBeUndefined();
  });

  it('serializes via JSON.stringify — no access-time throw on probe keys like toJSON', () => {
    const constants = nodeConstants();
    expect((constants as { toJSON?: unknown }).toJSON).toBeUndefined();
    expect(() => JSON.stringify(constants)).not.toThrow();
    const roundTripped = JSON.parse(JSON.stringify(constants)) as Record<string, number>;
    expect(roundTripped.O_RDONLY).toBe(fsConstants.O_RDONLY);
  });
});
