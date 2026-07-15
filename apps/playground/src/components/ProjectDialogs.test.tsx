import { renderToString } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import type { Dialog } from '../glue/page-store.ts';
import { ProjectDialogs } from './ProjectDialogs.tsx';

type DialogProps = Parameters<typeof ProjectDialogs>[0];

const render = (dialog: Dialog, extra: Partial<DialogProps> = {}) =>
  renderToString(() =>
    ProjectDialogs({
      dialog,
      ownerBlocked: false,
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
      onConfirmResetSandbox: () => {},
      onSwitchSaveThen: () => {},
      onSwitchDiscardThen: () => {},
      ...extra,
    }),
  );

const disabledCount = (html: string): number =>
  html.match(/\sdisabled(?:=""|(?=[\s>]))/g)?.length ?? 0;

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
  it('reset-sandbox: wipe-all copy + confirm action', () => {
    const html = render({ kind: 'reset-sandbox' });
    expect(html).toContain('Reset browser sandbox?');
    expect(html).toContain('OPFS, storage, caches, service worker');
    expect(html).toContain('confirm-reset-browser-sandbox');
  });
  it('renders nothing when dialog is null', () => {
    expect(render(null)).not.toContain('rf-dialog');
  });

  it('concurrent-same-key fault: blocks owner confirms but leaves cancel and unrelated deletes available', () => {
    expect(
      disabledCount(render({ kind: 'save', defaultName: 'react' }, { ownerBlocked: true })),
    ).toBe(1);
    expect(
      disabledCount(
        render({ kind: 'rename', id: 'p1', current: 'node-api' }, { ownerBlocked: true }),
      ),
    ).toBe(1);
    expect(disabledCount(render({ kind: 'reset', id: 'p1' }, { ownerBlocked: true }))).toBe(1);
    expect(disabledCount(render({ kind: 'switch', pendingId: 'p1' }, { ownerBlocked: true }))).toBe(
      1,
    );
    expect(disabledCount(render({ kind: 'delete', id: 'p1' }, { ownerBlocked: true }))).toBe(0);
    expect(disabledCount(render({ kind: 'reset-sandbox' }, { ownerBlocked: true }))).toBe(0);
  });
});
