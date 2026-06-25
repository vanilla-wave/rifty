import { renderToString } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import { Icon, type IconName } from './icons.tsx';

const NEEDED: IconName[] = [
  'circle-check',
  'pencil-to-square',
  'arrow-rotate-left',
  'trash-bin',
  'triangle-exclamation-fill',
  'database',
  'clock',
  'box',
  'ellipsis-vertical',
  'circles-3-plus',
  'file-arrow-down',
];

describe('icons — launcher/dialog glyphs', () => {
  for (const name of NEEDED) {
    it(`renders a non-empty path for "${name}"`, () => {
      const html = renderToString(() => Icon({ name }));
      expect(html).toContain('<path');
      expect(html).toMatch(/d="[Mm][^"]+"/); // real geometry, not a blank glyph
    });
  }
});
