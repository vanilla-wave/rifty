/**
 * Unit tests for the walk-up helper that powers parent-aware lockfile replay.
 *
 * Background: pre-ADR-0042-follow-on, `installer-lockfile-reader` only
 * supported bare-name lookups (`node_modules/<name>`), which forced the
 * lockfile fast path to opt out whenever the lockfile contained any nested
 * entry. The opt-out cost was one extra packument round-trip per package on
 * every reinstall of a project with a diamond conflict (every real-world
 * graph hits this — express, vite, opencode all do).
 *
 * `pinnedEntryForParent` is the lookup primitive that fixes that. It
 * mirrors Node's resolver: walk up the parent's install path, checking
 * `<scope>/node_modules/<name>` at each ancestor scope, stop on the first
 * hit. The lockfile fast-path source uses this to ask "given that I'm
 * resolving `<name>` from a package installed at `<parentInstallPath>`,
 * which lockfile entry should I pin?"
 */
import { describe, expect, it } from 'vitest';
import { pinnedEntryForParent } from './installer-lockfile-reader.ts';
import type { Lockfile } from './linker.ts';

/** Tiny lockfile factory — only the fields the helper looks at. */
function lockfile(packages: Record<string, { version: string }>): Lockfile {
  return {
    name: 'root',
    version: '0.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: { '': { version: '0.0.0' }, ...packages },
  };
}

describe('pinnedEntryForParent — npm walk-up algorithm', () => {
  it('returns the entry at the parent scope when one exists there (closest wins)', () => {
    // Diamond conflict pinned at the parent: `wrapper` installed `ms` at its
    // own nested scope. A request for `ms` from `wrapper` must resolve to the
    // nested 2.0.0, not the root-level 2.1.3.
    const lf = lockfile({
      'node_modules/wrapper': { version: '1.0.0' },
      'node_modules/wrapper/node_modules/ms': { version: '2.0.0' },
      'node_modules/ms': { version: '2.1.3' },
    });

    const hit = pinnedEntryForParent(lf, 'ms', 'node_modules/wrapper');

    expect(hit).toBeDefined();
    expect(hit?.installPath).toBe('node_modules/wrapper/node_modules/ms');
    expect(hit?.entry.version).toBe('2.0.0');
  });

  it('walks up one ancestor scope when the parent scope has no entry (grandparent hit)', () => {
    // `wrapper` does not nest `ms`; the lookup must walk up to root.
    const lf = lockfile({
      'node_modules/wrapper': { version: '1.0.0' },
      'node_modules/wrapper/node_modules/inner': { version: '1.0.0' },
      'node_modules/ms': { version: '2.1.3' },
    });

    // Resolving `ms` from `inner` which lives at
    // `node_modules/wrapper/node_modules/inner` — walk-up trims the trailing
    // `/node_modules/inner` (no hit), then trims `/node_modules/wrapper`,
    // landing at root where `ms` is pinned.
    const hit = pinnedEntryForParent(lf, 'ms', 'node_modules/wrapper/node_modules/inner');

    expect(hit).toBeDefined();
    expect(hit?.installPath).toBe('node_modules/ms');
    expect(hit?.entry.version).toBe('2.1.3');
  });

  it('resolves a top-level (root-parent) request from the root scope', () => {
    const lf = lockfile({
      'node_modules/express': { version: '4.21.0' },
    });

    // Empty parent install path = root scope — only candidate is
    // `node_modules/<name>`.
    const hit = pinnedEntryForParent(lf, 'express', '');

    expect(hit).toBeDefined();
    expect(hit?.installPath).toBe('node_modules/express');
    expect(hit?.entry.version).toBe('4.21.0');
  });

  it('returns undefined when no ancestor scope contains the name', () => {
    const lf = lockfile({
      'node_modules/wrapper': { version: '1.0.0' },
    });

    // Asking for `missing` from any parent scope walks all the way to root
    // and finds nothing.
    expect(pinnedEntryForParent(lf, 'missing', 'node_modules/wrapper')).toBeUndefined();
    expect(pinnedEntryForParent(lf, 'missing', '')).toBeUndefined();
  });

  it('prefers the nearer ancestor over a deeper-ancestor copy of the same name', () => {
    // Three placements of `c` along one chain: root, intermediate, leaf.
    // Resolving `c` from the leaf parent must pick the leaf-scope entry; from
    // the intermediate parent must pick the intermediate; from the root, root.
    const lf = lockfile({
      'node_modules/c': { version: '1.0.0' },
      'node_modules/a': { version: '1.0.0' },
      'node_modules/a/node_modules/c': { version: '2.0.0' },
      'node_modules/a/node_modules/b': { version: '1.0.0' },
      'node_modules/a/node_modules/b/node_modules/c': { version: '3.0.0' },
    });

    expect(pinnedEntryForParent(lf, 'c', 'node_modules/a/node_modules/b')?.entry.version).toBe(
      '3.0.0',
    );
    expect(pinnedEntryForParent(lf, 'c', 'node_modules/a')?.entry.version).toBe('2.0.0');
    expect(pinnedEntryForParent(lf, 'c', '')?.entry.version).toBe('1.0.0');
  });
});
