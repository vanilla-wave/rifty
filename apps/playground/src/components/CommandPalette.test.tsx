import { createRoot, createSignal } from 'solid-js';
import { renderToString } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';
import { CommandPalette, type PaletteItem, activatePaletteItem } from './CommandPalette.tsx';

describe('CommandPalette', () => {
  it('concurrent-same-key fault: rechecks a disabled item at activation time', () => {
    createRoot((dispose) => {
      const [blocked, setBlocked] = createSignal(true);
      const run = vi.fn();
      const close = vi.fn();
      const item: PaletteItem = {
        id: 'tpl:real-vite',
        section: 'Templates',
        label: 'Real Vite',
        disabled: blocked,
        run,
      };

      const html = renderToString(() =>
        CommandPalette({ open: true, items: [item], onClose: close }),
      );
      expect(html).toMatch(/class="rf-palette__item"[^>]*disabled/);
      expect(activatePaletteItem(item, close)).toBe(false);
      expect(close).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();

      setBlocked(false);
      expect(activatePaletteItem(item, close)).toBe(true);
      expect(close).toHaveBeenCalledOnce();
      expect(run).toHaveBeenCalledOnce();
      dispose();
    });
  });
});
