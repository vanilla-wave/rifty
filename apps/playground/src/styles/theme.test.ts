import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('./theme.css', import.meta.url)), 'utf8');

describe('degraded theme tokens (ADR-0165)', () => {
  it('defines the degraded surface + warn-text tokens', () => {
    expect(css).toContain('--rf-degraded-surface: #221d1a');
    expect(css).toContain('--rf-warn-text: #ffce84');
  });
  it('styles the memory status bar and the degraded banner', () => {
    expect(css).toContain('.rf-statusbar[data-storage-mode="memory"]');
    expect(css).toContain('.rf-banner--degraded');
  });
});

describe('multi-project launcher styles (ADR-0165 §9)', () => {
  // Regression guard: the launcher/dialog/projects/starters CSS was missing in the
  // original PR (only chip/banner/status got styles), so the launcher rendered as an
  // unstyled block at the bottom of the page instead of a centered modal.
  it('makes the launcher + dialog veils fixed-position centered overlays', () => {
    for (const veil of ['.rf-launcher__veil', '.rf-dialog__veil']) {
      const block = css.slice(css.indexOf(veil), css.indexOf(veil) + 240);
      expect(block, `${veil} must be a fixed full-screen overlay`).toContain('position: fixed');
      expect(block).toContain('inset: 0');
      expect(block).toContain('justify-content: center');
    }
  });
  it('defines the launcher card, tabs, project cards, row menu, and dialog card', () => {
    for (const sel of [
      '.rf-launcher {',
      '.rf-launcher__tab[data-active="true"]',
      '.rf-starters__card',
      '.rf-projects__grid',
      '.rf-pcard {',
      '.rf-rowmenu {',
      '.rf-dialog {',
      '.rf-dialog__icon[data-tone="amber"]',
    ]) {
      expect(css, `missing style for ${sel}`).toContain(sel);
    }
  });
  it('adds the dialog/launcher button tones + ACTIVE badge', () => {
    for (const sel of ['.rf-btn--lime', '.rf-btn--amber', '.rf-btn--danger', '.rf-badge--active']) {
      expect(css).toContain(sel);
    }
  });
});
