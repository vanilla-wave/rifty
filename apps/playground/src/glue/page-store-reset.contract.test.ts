import { createRoot } from 'solid-js';
import { expect, it } from 'vitest';
import { createPageStore } from './page-store.ts';

it('an authoritative clean Scratch clears UNSAVED and the discard guard after Reset', () => {
  createRoot((dispose) => {
    const store = createPageStore();
    store.hydrateIndex({
      activeId: 'scratch',
      scratch: { starter: 'react', dirty: true, editedAt: 'before reset' },
      projects: [],
    });
    expect(store.dirty()).toBe(true);
    store.hydrateIndex({
      activeId: 'scratch',
      scratch: { starter: 'react', dirty: false, editedAt: 'after reset' },
      projects: [],
    });
    expect(store.dirty()).toBe(false);
    store.pickStarter('vue');
    expect(store.dialog()).toBeNull();
    dispose();
  });
});
