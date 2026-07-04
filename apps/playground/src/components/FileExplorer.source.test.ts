import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./FileExplorer.tsx', import.meta.url)), 'utf8');

/**
 * Residual pins only. The decisions live in file-explorer-core.ts (behavioral
 * node tests) and the render surface in FileExplorer.test.tsx (SSR). What is
 * left is client-only: solid SSR emits no event handlers and runs no effects,
 * so JSX wiring and createEffect bodies are behaviorally unobservable in node.
 */
describe('FileExplorer residual source pins (client-only wiring)', () => {
  it('tracks active root changes instead of capturing the boot root forever', () => {
    // residual source pin: root mirroring lives in a createEffect — a no-op under
    // the solid server runtime; pins the old capture-forever regression.
    expect(source).not.toContain('const root = props.root;');
    // residual source pin: the unowned poll must read the plain mirror the effect
    // updates, not a captured value.
    expect(source).toContain('rootNow = nextRoot');
  });

  it('stops inline-edit and action-button key events from bubbling into row handlers', () => {
    // residual source pin: event bubbling is DOM dispatch — unobservable without a browser.
    expect(source).toContain('onKeyDown={stopButtonKeyPropagation}');
    // residual source pin: the rename/create input swallows keys before row shortcuts fire.
    expect(source).toMatch(/onKeyDown=\{\(e\) => \{\s*e\.stopPropagation\(\);/);
  });

  it('binds rows and menu items to the extracted decision core', () => {
    // residual source pin: keyboard intents (file-explorer-core rowKeyIntent) reach rows.
    expect(source).toContain('onKeyDown={(e) => handleRowKey(e, row)}');
    // residual source pin: right-click opens the capability-gated menu.
    expect(source).toContain('onContextMenu={(e) => openContextMenu(e, row)}');
    // residual source pin: drags carry the rifty MIME payload from the row.
    expect(source).toContain('onDragStart={(e) => startRowDrag(e, row)}');
    // residual source pin: row drops resolve their target through the core mapping.
    expect(source).toContain('void dropOnTarget(e, dropTargetForRow(row, root()), row);');
    // residual source pin: menu clicks dispatch the composed item ids.
    expect(source).toContain('onClick={() => runMenuItem(item.id, menu())}');
  });
});
