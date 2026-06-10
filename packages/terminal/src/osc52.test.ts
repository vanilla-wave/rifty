import { describe, expect, it } from 'vitest';
import { extractOsc52Writes } from './osc52.ts';

const b64 = (text: string): string =>
  globalThis.btoa(String.fromCharCode(...new TextEncoder().encode(text)));

describe('extractOsc52Writes', () => {
  it('extracts BEL-terminated clipboard writes and strips the control sequence', () => {
    expect(extractOsc52Writes(`before\x1b]52;c;${b64('copied')}\x07after`)).toEqual({
      text: 'beforeafter',
      writes: [{ text: 'copied' }],
    });
  });

  it('extracts ST-terminated clipboard writes', () => {
    expect(extractOsc52Writes(`\x1b]52;;${b64('hello')}\x1b\\`)).toEqual({
      text: '',
      writes: [{ text: 'hello' }],
    });
  });

  it('ignores readback requests and invalid payloads', () => {
    expect(extractOsc52Writes('a\x1b]52;c;?\x07b\x1b]52;c;not base64!\x07c')).toEqual({
      text: 'abc',
      writes: [],
    });
  });

  it('ignores non-clipboard targets', () => {
    expect(extractOsc52Writes(`a\x1b]52;p;${b64('primary')}\x07b`)).toEqual({
      text: 'ab',
      writes: [],
    });
  });
});
