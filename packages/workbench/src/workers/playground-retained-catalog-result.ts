import type {
  PlaygroundCatalogCommand,
  PlaygroundRetainedCatalogResult,
} from '../workbench/internal/playground-owner-protocol.ts';
import type { PlaygroundProjectAuthority } from './playground-project-authority.ts';

type RetainedCatalogCommand = Extract<
  PlaygroundCatalogCommand,
  | { readonly kind: 'list-retained-orphans' }
  | { readonly kind: 'list-retained-orphan-entries' }
  | { readonly kind: 'read-retained-orphan-file' }
>;

export async function retainedCatalogResult(
  authority: PlaygroundProjectAuthority,
  command: RetainedCatalogCommand,
): Promise<PlaygroundRetainedCatalogResult> {
  if (command.kind === 'list-retained-orphans') {
    return { kind: 'orphans', orphans: await authority.listRetainedOrphans() };
  }
  if (command.kind === 'list-retained-orphan-entries') {
    return {
      kind: 'entries',
      id: command.id,
      entries: await authority.listRetainedOrphanEntries(command.id),
    };
  }
  const bytes = await authority.readRetainedOrphanFile(command.id, command.path);
  return { kind: 'file', id: command.id, path: command.path, bytes: [...bytes] };
}
