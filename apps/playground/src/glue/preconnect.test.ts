import { describe, expect, it } from 'vitest';
import { type PreconnectDocument, injectPreconnects } from './preconnect.ts';

interface FakeLink {
  rel: string;
  href: string;
  crossOrigin: string | null;
}

function fakeDocument(): { doc: PreconnectDocument; appended: FakeLink[] } {
  const appended: FakeLink[] = [];
  const doc: PreconnectDocument = {
    head: {
      querySelector: (selectors: string) =>
        appended.find((l) => selectors.includes(`href="${l.href}"`)) ?? null,
      appendChild: (node: unknown) => {
        appended.push(node as FakeLink);
        return node;
      },
    },
    createElement: () => ({ rel: '', href: '', crossOrigin: null }),
  };
  return { doc, appended };
}

describe('injectPreconnects', () => {
  it('appends one crossorigin preconnect per unique origin, skipping undefined + malformed', () => {
    const { doc, appended } = fakeDocument();
    injectPreconnects(doc, [
      'https://registry.rifty.dev/npm-registry',
      'https://eddy.rifty.dev',
      'https://eddy.rifty.dev/other-path', // same origin → deduped
      undefined,
      'not a url',
    ]);
    expect(appended.map((l) => l.href).sort()).toEqual([
      'https://eddy.rifty.dev',
      'https://registry.rifty.dev',
    ]);
    for (const link of appended) {
      expect(link.rel).toBe('preconnect');
      expect(link.crossOrigin).toBe('anonymous');
    }
  });

  it('is idempotent — a second call adds nothing', () => {
    const { doc, appended } = fakeDocument();
    injectPreconnects(doc, ['https://eddy.rifty.dev']);
    injectPreconnects(doc, ['https://eddy.rifty.dev']);
    expect(appended.length).toBe(1);
  });
});
