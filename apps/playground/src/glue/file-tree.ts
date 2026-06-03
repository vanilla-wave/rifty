/**
 * Pure helpers for the {@link ../components/FileExplorer.tsx | FileExplorer}
 * tree (ADR-0075). Solid-free and reader-injected so the sort / lazy-read /
 * icon logic is unit-testable with a fake `readdirSync` (no VFS, no DOM).
 */
import type { VfsDirent } from '@riftydev/vfs';
import { joinPath } from '@riftydev/vfs';

export interface TreeChild {
  /** Absolute VFS path. */
  readonly path: string;
  readonly name: string;
  readonly kind: 'file' | 'dir';
}

/** The slice of the sync mirror the tree reads (kept narrow for testing). */
export interface DirentReader {
  readdirSync(path: string): readonly VfsDirent[];
}

/** Directories first, then files, each case-insensitive alphabetical. */
export function sortDirents(entries: readonly VfsDirent[]): VfsDirent[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
}

/** Read+sort the immediate children of `dir` into {@link TreeChild}s (lazy: one level). */
export function readChildren(reader: DirentReader, dir: string): TreeChild[] {
  return sortDirents(reader.readdirSync(dir)).map((e) => ({
    path: joinPath(dir, e.name),
    name: e.name,
    kind: e.isDirectory ? 'dir' : 'file',
  }));
}

/**
 * A coarse file category from the extension, used to pick a glyph + accent in
 * the explorer (CSS keys off `data-cat`). Returning a category (not a raw
 * glyph) keeps this testable and the visual vocabulary in one CSS place.
 */
export function fileCategory(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
  switch (ext) {
    case 'js':
    case 'cjs':
    case 'mjs':
      return 'js';
    case 'ts':
      return 'ts';
    case 'jsx':
    case 'tsx':
      return 'jsx';
    case 'json':
      return 'json';
    case 'md':
    case 'markdown':
      return 'md';
    case 'css':
      return 'css';
    case 'html':
    case 'htm':
      return 'html';
    case 'txt':
    case 'log':
      return 'txt';
    default:
      if (name === 'package.json') return 'json';
      if (name.endsWith('lock') || name === 'package-lock.json' || name === 'pnpm-lock.yaml') {
        return 'lock';
      }
      return 'file';
  }
}

/** A single-glyph badge per category — bespoke, monochrome, no icon-font dep. */
export function glyphForCategory(cat: string): string {
  switch (cat) {
    case 'js':
    case 'jsx':
      return 'JS';
    case 'ts':
      return 'TS';
    case 'json':
      return '{}';
    case 'md':
      return 'M↓';
    case 'css':
      return '#';
    case 'html':
      return '<>';
    case 'txt':
      return '¶';
    case 'lock':
      return '⚿';
    default:
      return '◦';
  }
}
