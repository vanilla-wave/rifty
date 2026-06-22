import { renderToString } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import type { Dialog } from '../glue/page-store.ts';
import { ProjectDialogs } from './ProjectDialogs.tsx';

const render = (dialog: Dialog, extra: Partial<Parameters<typeof ProjectDialogs>[0]> = {}) =>
  renderToString(() =>
    ProjectDialogs({
      dialog,
      saveName: 'react-starter',
      renameName: 'node-api',
      targetName: 'node-api',
      starterLabel: 'React',
      switchDest: 'node-api',
      onSaveName: () => {},
      onRenameName: () => {},
      onCancel: () => {},
      onConfirmSave: () => {},
      onConfirmRename: () => {},
      onConfirmReset: () => {},
      onConfirmDelete: () => {},
      onSwitchSaveThen: () => {},
      onSwitchDiscardThen: () => {},
      ...extra,
    }),
  );

describe('ProjectDialogs', () => {
  it('save: name prefilled + "autosaves" copy', () => {
    const html = render({ kind: 'save', defaultName: 'react-starter' });
    expect(html).toContain('Save as project');
    expect(html).toContain('value="react-starter"');
    expect(html).toContain('autosaves');
  });
  it('reset: interpolates target + starter + "can\'t be undone"', () => {
    const html = render({ kind: 'reset', id: 'p1' });
    expect(html).toContain('node-api');
    expect(html).toContain('React');
    expect(html).toContain("can't be undone");
    expect(html).toContain('Reset files');
  });
  it('delete: "You can undo this right after" + Delete', () => {
    const html = render({ kind: 'delete', id: 'p1' });
    expect(html).toContain('You can undo this right after');
    expect(html).toContain('Delete');
  });
  it('switch-confirm: dest text + Save-then / Discard actions', () => {
    const html = render({ kind: 'switch', pendingId: 'p1' });
    expect(html).toContain('node-api');
    expect(html).toContain('Save scratch, then continue');
    expect(html).toContain('Discard & continue');
  });
  it('renders nothing when dialog is null', () => {
    expect(render(null)).not.toContain('rf-dialog');
  });
});
