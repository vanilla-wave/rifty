import { describe, expect, it } from 'vitest';
import { shouldCleanForDevBoot, shouldCleanForDevBootWithInstallState } from './dev-boot-clean.ts';

describe('shouldCleanForDevBoot (ADR-0165 §5) — clean on root OR template change', () => {
  it('false on the first boot (no prior dev run to clean after)', () => {
    expect(
      shouldCleanForDevBoot({
        lastTemplateId: null,
        lastRoot: null,
        nextTemplateId: 'vite',
        nextRoot: '/scratch',
      }),
    ).toBe(false);
  });

  it('true when the template changes at the same root', () => {
    expect(
      shouldCleanForDevBoot({
        lastTemplateId: 'vite',
        lastRoot: '/scratch',
        nextTemplateId: 'express-sqlite',
        nextRoot: '/scratch',
      }),
    ).toBe(true);
  });

  it('true when the root changes for the SAME template (multi-project regression)', () => {
    // Two projects from the same starter share templateId but must not share node_modules.
    expect(
      shouldCleanForDevBoot({
        lastTemplateId: 'vite',
        lastRoot: '/scratch',
        nextTemplateId: 'vite',
        nextRoot: '/projects/p1',
      }),
    ).toBe(true);
  });

  it('false on an identical template + root (same-project reload preserves the tree)', () => {
    expect(
      shouldCleanForDevBoot({
        lastTemplateId: 'vite',
        lastRoot: '/projects/p1',
        nextTemplateId: 'vite',
        nextRoot: '/projects/p1',
      }),
    ).toBe(false);
  });

  it('does not clean a from-scratch tree after npm install has stamped it', () => {
    expect(
      shouldCleanForDevBootWithInstallState({
        lastTemplateId: 'vite',
        lastRoot: '/scratch',
        nextTemplateId: 'socket-lab',
        nextRoot: '/scratch',
        fromScratch: true,
        installStampSatisfied: true,
      }),
    ).toBe(false);
  });

  it('still cleans a from-scratch switch before any install stamp exists', () => {
    expect(
      shouldCleanForDevBootWithInstallState({
        lastTemplateId: 'vite',
        lastRoot: '/scratch',
        nextTemplateId: 'socket-lab',
        nextRoot: '/scratch',
        fromScratch: true,
        installStampSatisfied: false,
      }),
    ).toBe(true);
  });
});
