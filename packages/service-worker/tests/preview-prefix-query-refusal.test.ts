import { describe, expect, it } from 'vitest';
import {
  configurePreviewServiceWorkerUrl,
  previewPrefixFromServiceWorkerUrl,
} from '../src/index.ts';

const script = 'https://host.test/sandbox/sw.js';
const key = '__rifty_preview_prefix';

describe('configured SW query refusal preserves opaque keys', () => {
  it('does not mistake a leading question mark or malformed opaque key for the reserved key', () => {
    const url = `${script}??${key}=opaque&%E0%A4=A`;
    expect(new URL(url).searchParams.has(key)).toBe(false);
    expect(previewPrefixFromServiceWorkerUrl(url)).toBe('/preview/');
    const configured = configurePreviewServiceWorkerUrl(url, '/sandbox/p/');
    expect(configured).toBe(`${url}&${key}=%2Fsandbox%2Fp%2F`);
    expect(previewPrefixFromServiceWorkerUrl(configured)).toBe('/sandbox/p/');
  });

  it('rejects percent-encoded reserved-key collisions and duplicate spelling', () => {
    const encodedKey = `%5f${key.slice(1)}`;
    const url = `${script}?${encodedKey}=%2Fsandbox%2Fp%2F`;
    expect(new URL(url).searchParams.has(key)).toBe(true);
    expect(() => configurePreviewServiceWorkerUrl(url, '/sandbox/p/')).toThrow(TypeError);
    expect(() => previewPrefixFromServiceWorkerUrl(`${url}&${key}=%2Fother%2F`)).toThrow(TypeError);
  });

  it.each(['%2Fp%2F%', '%2Fp%2F%E0%A4', '%2Fp%252f%2F'])(
    'rejects malformed encoding or forbidden separators in configured value %s',
    (value) => {
      expect(() => previewPrefixFromServiceWorkerUrl(`${script}?${key}=${value}`)).toThrow(
        TypeError,
      );
    },
  );
});
